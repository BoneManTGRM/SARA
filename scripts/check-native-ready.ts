import { NativeCodingVerifier } from "../src/native-coding-verifier.ts";
const verifier = await NativeCodingVerifier.create();
if (!verifier) throw new Error("Native release checks require the qualified linux-x64 platform");
console.log(JSON.stringify({ checker: "7.0.2", legacyFinalRequired: true, engineDigest: verifier.engineDigest }));
