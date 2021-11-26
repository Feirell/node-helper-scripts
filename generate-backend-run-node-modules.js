const fsp = require('fs/promises');
const path = require('path');
const child_process = require('child_process');

const monoPath = path.join(__dirname, '..');
const {DIRECTORY_NAME = 'backend-only-dependencies'} = process.env;
const backendSpecificPath = path.join(monoPath, DIRECTORY_NAME);

const packagePath = p => path.join(p, 'package.json');
const lockPath = p => path.join(p, 'package-lock.json');

const readJSON = async (p) =>
    JSON.parse(await fsp.readFile(p, 'utf8'));

const writeJSON = (p, content) =>
    fsp.writeFile(p, JSON.stringify(content, undefined, 2), 'utf8');

const exec = (command, args, options = {}) => new Promise((resolve) => {
    const proc = child_process.spawn(command, args, options);

    proc.stdout.pipe(process.stdout, {end: false});
    proc.stderr.pipe(process.stderr, {end: false});

    proc.on('close', code => {
        if (code === 0)
            resolve();
        else
            process.exit(code);
    });
});

const stat = p =>
    fsp.stat(p)
        .then(r => {
            if (r.isFile())
                return 'file';
            else if (r.isDirectory())
                return 'directory';
            else
                throw new Error(p + ' has an unknown type ' + r.mode);
        })
        .catch(e => {
            if (e.code === 'ENOENT')
                return undefined;
            else
                throw e;
        })

/*
    As the README states, this script is meant to reduce the final size of the backend container.
    This is done by selecting only the needed dependencies of all defined.

    Those are then written to a package.json in a new directory.
    After this the package-lock.json is copied to this directory to provide npm with the version which should be installed.

    Then npm i is executed and a new, much smaller, node_modules directory is created.
 */
const generateNodeModules = async () => {
    const dirStats = await stat(backendSpecificPath);

    if (dirStats === undefined)
        await fsp.mkdir(backendSpecificPath)
    else if (dirStats === 'file')
        throw new Error('Wanted to use the path' + backendSpecificPath + ' for the directory to store the new ' +
            'package.json but there is a file with the same name. Use $DIRECTORY_NAME to change the used name.');

    const packageMono = await readJSON(packagePath(monoPath));

    if (typeof packageMono != 'object')
        throw new Error('The package.json of the mono repo has not an object as root');

    // loading the subselection of the keys for the backend

    const backendRunOnlyDependenciesKey = 'backendRunOnlyDependencies';

    if (!(backendRunOnlyDependenciesKey in packageMono))
        throw new Error('The package.json of the mono repo does not contain the key ' + backendRunOnlyDependenciesKey);

    const backendRunOnlyDependencies = packageMono[backendRunOnlyDependenciesKey];

    if (!Array.isArray(backendRunOnlyDependencies))
        throw new Error('The field ' + backendRunOnlyDependenciesKey + ' in the package.json of the mono repo does not contain an array but ' + backendRunOnlyDependencies);


    // loading the dependencies of the package.json

    const dependenciesKey = 'dependencies';

    if (!(dependenciesKey in packageMono))
        throw new Error('The package.json of the mono repo does not contain the key ' + dependenciesKey);

    const monoDependencies = packageMono[dependenciesKey];

    if (typeof monoDependencies != 'object')
        throw new Error('The field ' + dependenciesKey + ' in the package.json of the mono repo does not contain an object but ' + monoDependencies);

    // Building new dependencies semver object with the subselection

    const subselectedDependencies = {};

    for (const dep of backendRunOnlyDependencies) {
        if (typeof dep != 'string')
            throw new Error('The backend only dependencies contains a value which is not a string but ' + dep);

        if (!(dep in monoDependencies))
            throw new Error('The dependency ' + dep + ' was requested for the backend run but is not part of the dependencies in the package.json of the mono repo.');

        // Copying the semver range to the new dependency listing
        subselectedDependencies[dep] = monoDependencies[dep];
    }

    // copying the lock to have the same versions used in development in the run
    await fsp.copyFile(lockPath(monoPath), lockPath(backendSpecificPath));
    console.log('created a new package.json with a subsection of the needed backend dependencies');

    // writing the new and temporary package.json
    await writeJSON(packagePath(backendSpecificPath), {[dependenciesKey]: subselectedDependencies});
    console.log('copied package-lock.json to the backend dependencies directory');

    console.log('executing npm i to get a subsection of the node_modules directory');
    await exec('npm', ['i'], {cwd: backendSpecificPath, shell: true});
};

generateNodeModules()
    .catch(e => {
        console.error(e);
        process.exit(1);
    });
