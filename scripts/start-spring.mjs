import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const server = spawn(windows ? "mvnw.cmd" : "sh", windows ? ["spring-boot:run"] : ["./mvnw", "spring-boot:run"], {
  cwd: fileURLToPath(new URL("../backend/", import.meta.url)),
  stdio: "inherit",
  shell: windows,
});
server.on("error", (error) => {
  console.error(`Could not start Spring Boot: ${error.message}`);
  process.exitCode = 1;
});
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
