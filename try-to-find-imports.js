const fsp = require('fs/promises');
const path = require('path');
const {builtinModules} = require('module');

const getAbsoluteImports = (sourceCode) => {
    const matcher = /^ *import .*? from ["'](?:(@[^\/]*?\/[^\/]*?)|([^.\/@].*?))(?:\/.*)?["'] *;? *$/gm;

    const ret = [];
    let res;

    while ((res = matcher.exec(sourceCode)) !== null) {
        const [fullLine, atImport, moduleImport] = res;
        ret.push({
            fullLine,
            name: atImport || moduleImport
        });
    }

    return ret;
}

const handleDirectory = async (dir, printName = '') => {
    const rec = [];
    const own = [];

    for (const entry of await fsp.readdir(dir, {withFileTypes: true})) {
        if (entry.isDirectory()) {
            const fullPath = path.join(dir, entry.name);
            const appendedPrintName = path.join(printName, entry.name);
            rec.push(handleDirectory(fullPath, appendedPrintName));
        } else if (entry.isFile()) {
            if (!entry.name.endsWith('.ts'))
                continue;

            own.push((async () => {
                const fc = await fsp.readFile(path.join(dir, entry.name), 'utf-8');
                const importStrings = getAbsoluteImports(fc);
                return {
                    filename: path.join(printName, entry.name),
                    findings: importStrings
                }
            })());
        }
    }

    let results = (await Promise.all(own))
        .filter(r => r.findings.length > 0);

    const recResolves = await Promise.all(rec);

    for (const res of recResolves)
        results = results.concat(res);

    return results;
}


const collectResults = (results) => {
    const possibleModule = new Map();

    for (const {filename: foundIn, findings} of results) {
        for (const {name, fullLine} of findings) {
            if (possibleModule.has(name))
                continue;

            possibleModule.set(name, {name, fullLine, foundIn,});
        }
    }

    return Array.from(possibleModule.values())
        .sort((a, b) => a.name.localeCompare(b.name))
};

const generateModuleListing = async () => {
    const srcRoot = path.join(__dirname, '..', 'backend', 'src');

    const fileExtracts = await handleDirectory(srcRoot);
    const results = collectResults(fileExtracts)
        .filter(({name}) => !builtinModules.includes(name));

    const maxName = results.reduce((p, e) => Math.max(p, e.name.length), 0);

    // await fsp.writeFile('result.json', JSON.stringify(results, undefined, 2), 'utf8');
    for (const {name, foundIn, fullLine} of results)
        console.log(name.padEnd(maxName, ' ') + ' ' + foundIn + '    ( ' + fullLine + ' )');

    console.log('\nassumed external modules:');
    console.log(JSON.stringify(results.map(r => r.name)));
};

generateModuleListing()
    .catch(e => {
        console.error(e);
        process.exit(1);
    });
