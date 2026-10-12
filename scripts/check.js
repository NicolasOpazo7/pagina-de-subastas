const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let count = 0;
for (const directory of ['backend', 'frontend', 'scripts', 'tests']) {
  for (const file of fs.readdirSync(directory))
    if (file.endsWith('.js')) {
      new vm.Script(fs.readFileSync(path.join(directory, file), 'utf8'), {
        filename: path.join(directory, file),
      });
      count++;
    }
}
new vm.Script(fs.readFileSync('server.js', 'utf8'), { filename: 'server.js' });
console.log(`Sintaxis OK: ${count + 1} archivos.`);
