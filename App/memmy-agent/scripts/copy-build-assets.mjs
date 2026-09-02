import fs from "node:fs";
import path from "node:path";

const staleDirectories = ["dist/skills/goal", "dist/skills/memory", "dist/skills/my"];
const staleFiles = [
  "dist/core/agent-runtime/tools/self.js",
  "dist/core/agent-runtime/tools/self.js.map",
  "dist/core/agent-runtime/tools/self.d.ts",
  "dist/core/agent-runtime/tools/runtime-state.js",
  "dist/core/agent-runtime/tools/runtime-state.js.map",
  "dist/core/agent-runtime/tools/runtime-state.d.ts",
];

for (const target of staleDirectories) fs.rmSync(target, { recursive: true, force: true });
for (const target of staleFiles) fs.rmSync(target, { force: true });
// Replace the DOCX skill directory as a unit so removed script extensions do
// not survive in dist from an earlier build.
fs.rmSync(path.join("dist", "skills", "docx"), { recursive: true, force: true });

for (const source of ["src/templates", "src/skills"]) {
  const destination = path.join("dist", path.relative("src", source));
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) => !entry.endsWith(".ts"),
  });
}

const renderingSource = path.resolve("extra-dependencies/docx-rendering");
const renderingDestination = path.resolve("dist/extra-dependencies/docx-rendering");
if (fs.existsSync(renderingSource)) {
  const staging = `${renderingDestination}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(renderingSource, staging, { recursive: true, force: true });
  fs.rmSync(renderingDestination, { recursive: true, force: true });
  fs.renameSync(staging, renderingDestination);
}
