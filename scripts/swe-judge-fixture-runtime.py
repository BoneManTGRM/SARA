"""Disposable internal judge network with a fixed public-fixture proxy.

The model producer never imports this module or joins either network.
"""
import ipaddress
import json
from pathlib import Path
import tempfile


class FixtureRuntime:
    def __init__(self, client, run_id, runtime_image, output):
        self.client, self.run_id, self.runtime_image = client, run_id, runtime_image
        self.output = output
        self.network = None
        self.proxy = None
        self.proxy_address = None
        self.image_id = None

    def start(self):
        labels = {"sara.repositoryJudgeRun": self.run_id}
        script = Path(__file__).with_name("swe-judge-fixture-proxy.py")
        self.client.images.pull(self.runtime_image)
        with tempfile.TemporaryDirectory(prefix="sara-fixture-") as directory:
            root = Path(directory)
            (root / "proxy.py").write_bytes(script.read_bytes())
            (root / "Dockerfile").write_text(
                f"FROM {self.runtime_image}\nCOPY proxy.py /proxy.py\nUSER 65534:65534\n"
                'ENTRYPOINT ["python3", "-I", "-u", "/proxy.py"]\n')
            image, _ = self.client.images.build(path=str(root), network_mode="none", rm=True)
            self.image_id = image.id
        self.network = self.client.networks.create("sara-fixture-" + self.run_id,
            driver="bridge", internal=True, labels=labels,
            options={"com.docker.network.bridge.gateway_mode_ipv4": "isolated"})
        self.network.reload()
        if (self.network.attrs.get("Internal") is not True or
                self.network.attrs.get("Options", {}).get("com.docker.network.bridge.gateway_mode_ipv4") != "isolated"):
            raise ValueError("FIXTURE_INTERNAL_ISOLATION_UNAVAILABLE")
        # Only the proxy joins an external network. Nothing is published to host.
        self.proxy = self.client.containers.create(self.image_id, detach=True, network="bridge",
            name="sara-fixture-proxy-" + self.run_id, labels=labels,
            cap_drop=["ALL"], security_opt=["no-new-privileges"], read_only=True,
            user="65534:65534", mem_limit="64m", memswap_limit="64m", pids_limit=32,
            nano_cpus=250_000_000, tmpfs={"/tmp": "rw,nosuid,nodev,noexec,size=16m"})
        self.network.connect(self.proxy)
        self.proxy.start()
        self.proxy.reload()
        address = self.proxy.attrs["NetworkSettings"]["Networks"][self.network.name]["IPAddress"]
        if not isinstance(ipaddress.ip_address(address), ipaddress.IPv4Address):
            raise ValueError("FIXTURE_PROXY_ADDRESS")
        self.proxy_address = address
        # Wait locally for the server without granting the judge any host route.
        probe = self.proxy.exec_run(["python3", "-I", "-c",
            "import socket,time\nfor i in range(50):\n try:\n  s=socket.create_connection(('127.0.0.1',8080),.1);s.close();break\n except OSError:time.sleep(.1)\nelse:raise SystemExit(1)"])
        if probe.exit_code:
            raise ValueError("FIXTURE_PROXY_NOT_READY")
        return self

    def judge_options(self):
        if not self.proxy_address or not self.network:
            raise ValueError("FIXTURE_PROXY_NOT_STARTED")
        proxy = "http://" + self.proxy_address + ":8080"
        return {"network_mode": self.network.name, "network_disabled": False,
                "dns": ["127.0.0.1"], "dns_opt": ["timeout:1", "attempts:1"],
                "environment": {"HTTP_PROXY": proxy, "HTTPS_PROXY": proxy,
                                "http_proxy": proxy, "https_proxy": proxy,
                                "NO_PROXY": "localhost,127.0.0.1,::1",
                                "no_proxy": "localhost,127.0.0.1,::1"}}

    def verify_judge_network(self, container):
        container.reload()
        if set(container.attrs["NetworkSettings"]["Networks"]) != {self.network.name}:
            raise ValueError("FIXTURE_JUDGE_NETWORK_ATTACHMENT")
        code = r'''import json,socket,sys
socket.setdefaulttimeout(2)
result={}
result['localhost']=any(x[4][0]=='127.0.0.1' for x in socket.getaddrinfo('localhost',80))
try:
 s=socket.create_connection(('1.1.1.1',443),2);s.close();result['directBlocked']=False
except OSError:result['directBlocked']=True
try:socket.getaddrinfo('example.org',443);result['dnsBlocked']=False
except OSError:result['dnsBlocked']=True
for name,host in [('otherHost','example.org'),('metadata','169.254.169.254')]:
 url='https://'+host+'/get'
 try:
  with socket.create_connection((sys.argv[1],8080),2) as stream:
   stream.sendall(('GET '+url+' HTTP/1.1\r\nHost: '+host+'\r\nConnection: close\r\n\r\n').encode())
   line=stream.recv(4096).split(b'\r\n',1)[0]
   result[name]=len(line.split())>1 and line.split()[1]==b'403'
 except OSError:result[name]=False
print(json.dumps(result))
raise SystemExit(0 if all(result.values()) else 1)
'''
        tested = container.exec_run(["python3", "-I", "-c", code,
                                     self.proxy_address])
        (self.output / "fixture-isolation-probes.json").write_text(json.dumps({
            "exitCode": tested.exit_code, "output": tested.output.decode(errors="replace")[:4000]}))
        if tested.exit_code:
            raise ValueError("FIXTURE_ISOLATION_PROBE_FAILED")

    def close(self):
        errors = []
        if self.proxy:
            try:
                logs = self.proxy.logs(stdout=True, stderr=True)
                (self.output / "fixture-proxy.log").write_bytes(logs[:131072])
            except Exception as error:
                errors.append("logs:" + type(error).__name__)
            try:
                self.proxy.remove(force=True)
            except Exception as error:
                errors.append("container:" + type(error).__name__)
        if self.network:
            try:
                self.network.remove()
            except Exception as error:
                errors.append("network:" + type(error).__name__)
        (self.output / "fixture-cleanup.json").write_text(json.dumps({"errors": errors,
            "proxyImageId": self.image_id, "policy": "postman-https-get-only-v1"}))
        if errors:
            raise ValueError("FIXTURE_CLEANUP_FAILED:" + ",".join(errors))
