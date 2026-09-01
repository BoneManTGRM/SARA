import { resolve } from "node:path";
import { SaraKernel } from "./kernel.ts";
import { createSaraServer } from "./server.ts";

const stateDirectory = resolve(process.env.SARA_STATE_DIRECTORY ?? ".sara-state");
const host = process.env.SARA_HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const ownerTokenSha256 = process.env.SARA_OWNER_TOKEN_SHA256;
if (!ownerTokenSha256 || !/^[a-f0-9]{64}$/i.test(ownerTokenSha256)) {
  throw new Error("Set SARA_OWNER_TOKEN_SHA256 to a SHA-256 digest before starting the owner dashboard.");
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be a valid TCP port.");

const kernel = await SaraKernel.boot({ stateDirectory, ownerTokenSha256 });
const server = createSaraServer(kernel, { ownerTokenSha256 });
server.listen(port, host, () => {
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  console.log(`SARA owner dashboard listening on http://${host}:${resolvedPort}`);
});
