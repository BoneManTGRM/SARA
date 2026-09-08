"""Offline boundary tests; no real DNS, fixture requests or model calls."""
import asyncio
import importlib.util
import ipaddress
from pathlib import Path
import socket
import ssl
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

spec = importlib.util.spec_from_file_location("fixture_proxy", Path(__file__).resolve().parents[1] / "scripts/swe-judge-fixture-proxy.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def request(target="https://postman-echo.com/get?foo=bar", extra="", method="GET"):
    return (f"{method} {target} HTTP/1.1\r\nHost: postman-echo.com\r\n{extra}\r\n").encode()


def answer(ip):
    family = socket.AF_INET6 if ipaddress.ip_address(ip).version == 6 else socket.AF_INET
    return (family, socket.SOCK_STREAM, 6, "", (ip, 443, 0, 0) if family == socket.AF_INET6 else (ip, 443))


class PolicyTests(unittest.TestCase):
    def test_fixed_limits(self):
        self.assertEqual((p.MAX_CONNECTIONS, p.MAX_ACTIVE, p.MAX_BYTES, p.TIMEOUT), (32, 4, 1048576, 30))

    def test_only_exact_fixture(self):
        self.assertEqual(p.parse_request(request()), "/get?foo=bar")
        self.assertEqual(p.parse_request(request("https://postman-echo.com:443/get")), "/get")
        for target in ["http://postman-echo.com/get", "https://postman-echo.com:444/get", "https://evil.com/get", "https://127.0.0.1/get", "https://169.254.169.254/get", "https://postman-echo.com.evil/get", "https://user@postman-echo.com/get", "https://postman-echo.com/get#", "https://postman-echo.com/anything", "https://postman-echo.com/get?" + "a" * 2049]:
            with self.subTest(target=target[:80]), self.assertRaises(p.Denied):
                p.parse_request(request(target))
        for method in ["CONNECT", "POST", "HEAD", "get"]:
            with self.assertRaises(p.Denied):
                p.parse_request(request(method=method))

    def test_no_auth_bodies_or_ambiguous_headers(self):
        for header in ["Authorization: secret", "Proxy-Authorization: secret", "Cookie: secret", "Content-Length: 0", "Transfer-Encoding: chunked", "Expect: 100-continue", "Upgrade: websocket", "Host: evil", " folded", "Bad Name: a", "A: a\t", "A: a\r\nA: b"]:
            with self.subTest(header=header), self.assertRaises(p.Denied):
                p.parse_request(request(extra=header + "\r\n"))
        with self.assertRaises(p.Denied):
            p.parse_request(request(extra="X: " + "a" * 8192 + "\r\n"))

    def test_all_dns_answers_must_be_public(self):
        public = answer("93.184.216.34")
        self.assertEqual(p.validate_answers([public]), [(socket.AF_INET, ("93.184.216.34", 443))])
        for ip in ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.100.100.200", "168.63.129.16", "64:ff9b::a00:1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "2002:0808:0808::1"]:
            with self.subTest(ip=ip), self.assertRaises(p.Denied):
                p.validate_answers([public, answer(ip)])
        with self.assertRaises(p.Denied):
            p.validate_answers([])


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_socket_denial_and_oversized_header_never_connect_upstream(self):
        proxy = p.FixtureProxy()
        proxy.log = Mock()
        server = await asyncio.start_server(proxy.accept, "127.0.0.1", 0, limit=p.MAX_HEADER)
        try:
            with patch.object(p, "connect_fixture", AsyncMock()) as connect:
                for raw in [request("https://google.com/get"), request("https://169.254.169.254/get"), request(extra="X: " + "a" * 9000 + "\r\n")]:
                    reader, writer = await asyncio.open_connection("127.0.0.1", server.sockets[0].getsockname()[1])
                    writer.write(raw)
                    await writer.drain()
                    response = await asyncio.wait_for(reader.read(), timeout=1)
                    self.assertTrue(response.startswith(b"HTTP/1.1 403 Forbidden"))
                    writer.close()
                    await writer.wait_closed()
                connect.assert_not_awaited()
            self.assertEqual(proxy.active, 0)
        finally:
            server.close()
            await server.wait_closed()

    async def test_runtime_probe_sends_real_http_and_checks_destinations(self):
        runtime_spec = importlib.util.spec_from_file_location("fixture_runtime", Path(__file__).resolve().parents[1] / "scripts/swe-judge-fixture-runtime.py")
        runtime = importlib.util.module_from_spec(runtime_spec)
        runtime_spec.loader.exec_module(runtime)
        proxy = p.FixtureProxy()
        proxy.log = Mock()
        server = await asyncio.start_server(proxy.accept, "127.0.0.1", 8080, limit=p.MAX_HEADER)
        real_connect, real_dns = socket.create_connection, socket.getaddrinfo
        def connect(address, *args, **kwargs):
            if address[0] == "1.1.1.1": raise OSError("offline fixture")
            return real_connect(address, *args, **kwargs)
        def dns(host, *args, **kwargs):
            if host == "example.org": raise OSError("offline fixture")
            return real_dns(host, *args, **kwargs)
        class Container:
            attrs = {"NetworkSettings": {"Networks": {"internal": {}}}}
            def reload(self): pass
            def exec_run(self, command):
                try:
                    with patch.object(socket, "create_connection", connect), patch.object(socket, "getaddrinfo", dns), patch("sys.argv", ["probe", command[-1]]):
                        exec(compile(command[3], "runtime-probe", "exec"), {})
                except SystemExit as error:
                    return types.SimpleNamespace(exit_code=error.code, output=b"probe completed")
        try:
            with tempfile.TemporaryDirectory() as directory, patch.object(p, "connect_fixture", AsyncMock()) as upstream:
                fixture = runtime.FixtureRuntime(None, "test", "unused", Path(directory))
                fixture.network = types.SimpleNamespace(name="internal")
                fixture.proxy_address = "127.0.0.1"
                await asyncio.to_thread(fixture.verify_judge_network, Container())
                upstream.assert_not_awaited()
                self.assertEqual(proxy.connections, 2)
        finally:
            server.close()
            await server.wait_closed()

    async def test_root_execution_rejected(self):
        with patch.object(p.os, "geteuid", return_value=0), self.assertRaises(SystemExit):
            await p.main()

    async def test_numeric_peer_tls_hostname_and_default_validation(self):
        loop = asyncio.get_running_loop()
        fake_socket = Mock()
        opened = AsyncMock(return_value=(object(), object()))
        with patch.object(loop, "getaddrinfo", AsyncMock(return_value=[answer("93.184.216.34")])) as dns, patch.object(loop, "sock_connect", AsyncMock()) as connect, patch.object(p.socket, "socket", return_value=fake_socket), patch.object(p.asyncio, "open_connection", opened):
            await p.connect_fixture()
        dns.assert_awaited_once_with(p.HOST, 443, type=socket.SOCK_STREAM)
        connect.assert_awaited_once_with(fake_socket, ("93.184.216.34", 443))
        kwargs = opened.call_args.kwargs
        self.assertEqual(kwargs["server_hostname"], p.HOST)
        self.assertEqual(kwargs["ssl"].verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(kwargs["ssl"].check_hostname)

    async def test_byte_cap(self):
        for size in [p.MAX_BYTES, p.MAX_BYTES + 1]:
            reader = asyncio.StreamReader()
            reader.feed_data(b"x" * size)
            reader.feed_eof()
            writer = Mock(drain=AsyncMock())
            counts = {"down": 0}
            if size > p.MAX_BYTES:
                with self.assertRaises(p.Denied):
                    await p.bounded_copy(reader, writer, counts, "down")
            else:
                await p.bounded_copy(reader, writer, counts, "down")
            self.assertLessEqual(sum(len(c.args[0]) for c in writer.write.call_args_list), p.MAX_BYTES)

    async def test_admission_no_queue(self):
        proxy = p.FixtureProxy()
        proxy.log = Mock()
        blocker = asyncio.Event()
        async def handle(reader, writer):
            await blocker.wait()
        proxy.handle = handle
        tasks = []
        original = asyncio.create_task
        def create(coro):
            task = original(coro)
            tasks.append(task)
            return task
        with patch.object(p.asyncio, "create_task", create):
            for _ in range(40):
                proxy.accept(Mock(), Mock())
        self.assertEqual(len(tasks), 4)
        self.assertLessEqual(proxy.log.call_count, 33)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        proxy.active = 0
        with patch.object(p.asyncio, "create_task") as create:
            proxy.accept(Mock(), Mock())
            create.assert_not_called()

    async def test_request_rebuilt_and_pipelined_bytes_never_forwarded(self):
        client = asyncio.StreamReader()
        client.feed_data(request(extra="X-Secret: private\r\nConnection: X-Secret\r\n") + b"POST https://evil.com/ HTTP/1.1\r\n\r\nsecret")
        client.feed_eof()
        remote = asyncio.StreamReader()
        response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}"
        remote.feed_data(response)
        remote.feed_eof()
        upstream, downstream = Mock(drain=AsyncMock()), Mock(drain=AsyncMock())
        proxy = p.FixtureProxy()
        proxy.active = 1
        proxy.log = Mock()
        with patch.object(p, "connect_fixture", AsyncMock(return_value=(remote, upstream))):
            await proxy.handle(client, downstream)
        self.assertEqual(upstream.write.call_args.args[0], b"GET /get?foo=bar HTTP/1.1\r\nHost: postman-echo.com\r\nAccept: application/json\r\nConnection: close\r\n\r\n")
        self.assertEqual(downstream.write.call_args.args[0], response)
        self.assertEqual(proxy.log.call_args.args[0], "complete")
        upstream.transport.abort.assert_called_once()

    async def test_timeout_and_denial_do_not_leak_exception_or_request(self):
        for raw in [request("https://evil.com/get"), None]:
            reader = asyncio.StreamReader()
            if raw:
                reader.feed_data(raw)
            proxy = p.FixtureProxy()
            proxy.active = 1
            proxy.log = Mock()
            writer = Mock(drain=AsyncMock())
            with patch.object(p, "TIMEOUT", 0.01), patch.object(p, "connect_fixture", AsyncMock()) as connect:
                await proxy.handle(reader, writer)
                connect.assert_not_awaited()
            self.assertEqual(proxy.active, 0)
            if raw:
                self.assertTrue(writer.write.call_args.args[0].startswith(b"HTTP/1.1 403"))
            self.assertEqual(proxy.log.call_args.args[0], "policy_denied" if raw else "timeout")
            writer.transport.abort.assert_called_once()


if __name__ == "__main__":
    unittest.main()
