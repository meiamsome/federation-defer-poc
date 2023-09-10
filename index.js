import { readFile, readdir } from 'fs/promises';
import path from 'path';

const servers = [
    {
        name: 'Monolith',
        url: 'http://base:8080/',
    },
    {
        name: 'Apollo Router',
        url: 'http://apollo-router:4000/',
    },
    {
        name: 'POC-no-defer',
        url: 'http://defer-poc:8090/',
        headers: {
            'x-subgraph-defer': 'false',
        },
    },
    {
        name: 'POC-defer',
        url: 'http://defer-poc:8090/',
        headers: {
            'x-subgraph-defer': 'true',
        },
    },
];
const queryFolder = path.join(
    process.cwd(),
    'queries',
);
const queries = (await readdir(queryFolder)).filter((path) => path.endsWith('.graphql'));

const request = async (url, headers, query) => {
    const resp = await fetch(
        url,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(query),
        },
    );

    if (!resp.ok)
        throw new Error(`Request to ${url} failed: ${resp.status}\n${await resp.text()}`);
    const result = await resp.json();
    if (result.errors?.length)
        throw new Error(`Errors calling ${url}:${result.errors.map(x => JSON.stringify(x)).join(`\n`)}`);
    return result.data;
}

const deepCompare = (left, right, path) => {
    if (left === right)
        return;
    if (left == undefined)
        throw new Error(`Mismatch at ${path.join('.')}`);
    if (Array.isArray(left)) {
        if (!Array.isArray(right))
            throw new Error(`Mismatch at ${path.join('.')}`);
        for (const i in left) {
            deepCompare(left[i], right[i], [...path, i]);
        }
        return;
    }
    if (left instanceof Object) {
        if (!(right instanceof Object))
            throw new Error(`Mismatch at ${path.join('.')}`);
        const keys = [...new Set([
            ...Object.keys(left),
            ...Object.keys(right),
        ])];
        for (const key of keys)
            deepCompare(left[key], right[key], [...path, key]);
        return;
    }

    throw new Error('unimplemented');
}

console.table(
    Object.fromEntries(await Promise.all(queries.map(async (queryFilename) => {{
        const queryName = queryFilename.split('.')[0];
        const [
            queryBuffer,
            variablesBuffer,
        ] = await Promise.all([
            readFile(path.join(queryFolder, queryFilename)),
            readFile(path.join(queryFolder, `${queryName}.variables.json`)),
        ]);
        const query = queryBuffer.toString();
        const variables = JSON.parse(variablesBuffer.toString());

        const allServerResults = await Promise.all(servers.map(async (server) => {
            const start = performance.now();
            const data = await request(
                server.url,
                server.headers,
                {
                    query,
                    variables,
                },
            );
            const end = performance.now();
            const duration = Math.ceil((end - start) / 10) / 100;
            return {
                name: server.name,
                data,
                duration,
            };
        }));
        const correctResponse = allServerResults[0].data;

        for (const { name, data } of allServerResults.slice(1)) {
            deepCompare(correctResponse, data, [queryName, name]);
        }

        return [
            queryName,
            Object.fromEntries(allServerResults.map(({ name, duration }) => [name, duration])),
        ];
    }}))),
    servers.map(({ name }) => name),
);
