// Converts build/256x256.png into build/icon.ico (multi-size container).
// Run after scripts/make-icon.cjs — wired as `npm run icon`.
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default || pngToIcoModule;
const fs = require("fs");

Promise.resolve(pngToIco(["build/256x256.png"]))
  .then((buf) => {
    fs.writeFileSync("build/icon.ico", buf);
    console.log("build/icon.ico written:", buf.length, "bytes");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
