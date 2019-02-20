const fs = require('fs');
const path = require('path');
const transform = require('../index');


const res = transform({
    isRoot: false,
    isApp: false,
    sourcePath: __dirname,
    outputPath: __dirname,
    isTyped: false,

    code: fs.readFileSync(path.resolve(__dirname, './source.jsx'))
})

fs.writeFileSync(path.resolve(__dirname, './result/code.js'), res.code);
fs.writeFileSync(path.resolve(__dirname, './result/template.wxml'), res.template);