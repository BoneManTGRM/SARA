#!/usr/bin/env python3
"""Unactivated judge-only fixture candidate. No general proxy or CONNECT tunnel.

Accepts one absolute-form GET for https://postman-echo.com[:443]/get per
connection. Rebuilds outbound headers, validates every DNS answer, pins the
numeric peer and validates TLS against the fixed hostname. Never follows
redirects. Docker network isolation, image pinning and lifetime are caller-owned.
"""
import asyncio
import ipaddress
import json
import os
import re
import socket
import ssl
from urllib.parse import urlsplit

HOST = "postman-echo.com"
PORT = 443
MAX_CONNECTIONS = 32
MAX_ACTIVE = 4
MAX_BYTES = 1024 * 1024
MAX_HEADER = 8192
MAX_QUERY = 2048
TIMEOUT = 30


class Denied(Exception):
    pass


def parse_request(raw):
    if len(raw) > MAX_HEADER or not raw.endswith(b"\r\n\r\n"):
        raise Denied()
    try:
        lines = raw.decode("ascii").split("\r\n")
        method, target, version = lines[0].split(" ")
        url = urlsplit(target)
        if (method != "GET" or version != "HTTP/1.1"
                or url.scheme != "https"
                or url.netloc not in (HOST, HOST + ":443")
                or url.path != "/get" or url.fragment or "#" in target
                or len(url.query) > MAX_QUERY
                or any(ord(c) < 33 or ord(c) > 126 for c in target)):
            raise Denied()
        headers = {}
        for line in lines[1:-2]:
            key, value = line.split(":", 1)
            if not re.fullmatch(r"[A-Za-z0-9-]+", key):
                raise Denied()
            key = key.lower()
            if key in headers or any(ord(c) < 32 or ord(c) > 126 for c in value):
                raise Denied()
            headers[key] = value.strip()
        if headers.get("host") not in (HOST, HOST + ":443"):
            raise Denied()
        if any(key in headers for key in (
                "authorization", "proxy-authorization", "cookie", "content-length",
                "transfer-encoding", "expect", "upgrade")):
            raise Denied()
        # No client headers (including Connection nominated headers) are forwarded.
        return "/get" + (("?" + url.query) if url.query else "")
    except (ValueError, UnicodeError):
        raise Denied() from None


def validate_answers(answers):
    if not answers:
        raise Denied()
    result = []
    for family, kind, protocol, _, address in answers:
        if family not in (socket.AF_INET, socket.AF_INET6) or kind != socket.SOCK_STREAM:
            raise Denied()
        try:
            ip = ipaddress.ip_address(address[0])
        except ValueError:
            raise Denied() from None
        if (not ip.is_global or ip.is_multicast or ip.is_reserved
                or ip.is_loopback or ip.is_link_local or ip.is_unspecified
                or (ip.version == 6 and (ip.ipv4_mapped or ip.sixtofour or ip.teredo))
                or str(ip) == "168.63.129.16"
                or (ip.version == 6 and ip in ipaddress.ip_network("64:ff9b::/96"))
                or "%" in address[0] or address[1] != PORT
                or (family == socket.AF_INET6 and (address[2] or address[3]))):
            raise Denied()
        result.append((family, address))
    return result


async def connect_fixture():
    loop = asyncio.get_running_loop()
    answers = validate_answers(await loop.getaddrinfo(HOST, PORT, type=socket.SOCK_STREAM))
    # One validated numeric peer, no fallback DNS lookup or environment proxy.
    family, address = answers[0]
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.setblocking(False)
    try:
        await loop.sock_connect(sock, address)
        return await asyncio.open_connection(sock=sock, ssl=ssl.create_default_context(),
                                             server_hostname=HOST, limit=MAX_HEADER)
    except BaseException:
        sock.close()
        raise


async def bounded_copy(reader, writer, counters, direction):
    while True:
        data = await reader.read(min(65536, MAX_BYTES - counters[direction] + 1))
        if not data:
            return
        if counters[direction] + len(data) > MAX_BYTES:
            raise Denied()
        writer.write(data)
        counters[direction] += len(data)
        await writer.drain()


class FixtureProxy:
    def __init__(self):
        self.connections = 0
        self.active = 0

    def log(self, outcome, counters):
        print(json.dumps({"event": "fixture_connection", "outcome": outcome,
                          "connections": self.connections, "active": self.active,
                          "upstreamBytes": counters["up"], "downstreamBytes": counters["down"]}),
              flush=True)

    def accept(self, reader, writer):
        # Synchronous admission avoids an unbounded queue of tasks or pending writes.
        self.connections += 1
        if self.connections > MAX_CONNECTIONS or self.active >= MAX_ACTIVE:
            writer.close()
            # Suppress unlimited log amplification after the lifetime cap.
            if self.connections <= MAX_CONNECTIONS + 1:
                self.log("capacity_denied", {"up": 0, "down": 0})
            return
        self.active += 1
        asyncio.create_task(self.handle(reader, writer))

    async def handle(self, reader, writer):
        counts = {"up": 0, "down": 0}
        upstream = None
        outcome = "complete"
        try:
            async with asyncio.timeout(TIMEOUT):
                raw = await reader.readuntil(b"\r\n\r\n")
                path = parse_request(raw)
                remote, upstream = await connect_fixture()
                request = ("GET " + path + " HTTP/1.1\r\nHost: " + HOST
                           + "\r\nAccept: application/json\r\nConnection: close\r\n\r\n").encode("ascii")
                counts["up"] = len(request)
                upstream.write(request)
                await upstream.drain()
                # Only the rebuilt GET is sent: pipelined requests and client bodies
                # are never forwarded. Raw HTTP response preserves the real fixture.
                await bounded_copy(remote, writer, counts, "down")
        except (Denied, asyncio.LimitOverrunError, asyncio.IncompleteReadError):
            outcome = "policy_denied"
            if counts["down"] == 0:
                writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                try:
                    await asyncio.wait_for(writer.drain(), timeout=0.2)
                except Exception:
                    pass
        except TimeoutError:
            outcome = "timeout"
        except Exception:
            outcome = "transport_error"
        finally:
            # Do not wait on an upstream TLS close handshake. Flush the bounded
            # plaintext response before closing; abort only a stalled client.
            if upstream is not None:
                upstream.transport.abort()
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=0.2)
            except Exception:
                writer.transport.abort()
            self.active -= 1
            self.log(outcome, counts)


async def main():
    if os.geteuid() == 0:
        raise SystemExit("fixture proxy must run as a nonroot user")
    proxy = FixtureProxy()
    server = await asyncio.start_server(proxy.accept, "0.0.0.0", 8080,
                                        limit=MAX_HEADER, backlog=MAX_ACTIVE)
    print(json.dumps({"event": "fixture_ready", "port": 8080,
                      "policy": "postman_echo_https_get_only_v1"}), flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
