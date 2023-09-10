import { readFile } from 'fs/promises';
import { buildSchema, executeSync, parse, validate } from 'graphql';
import path from 'path';
import { createServer } from 'http'
import { createPlan } from './plan.js';
import { execute } from './execute.js';

const PORT = process.env.port ?? 8090;

const supergraphFilename = process.argv[2];

const schemaData = (await readFile(
    path.join(
        process.cwd(),
        supergraphFilename,
    ),
)).toString();

const schema = buildSchema(schemaData);

const streamToPromise = (stream) => {
    let resolve, reject;
    const promise = new Promise((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    const data = [];
    stream.on('data', (_data) => data.push(_data));
    stream.on('end', () => resolve(data));
    stream.on('error', (error) => reject(error));
    return promise;
}

const server = createServer((req, res) => {
    (async () => {
        if (req.method !== 'POST')
            throw new Error('only POST supported.')

        const {
            query,
            variables
        } = JSON.parse(Buffer.concat(await streamToPromise(req)).toString());

        const document = parse(query);
        const errors = validate(schema, document);
        if (errors.length)
            throw errors[0];

        const plan = createPlan(schema, document);
        console.log('PLAN:');
        console.log(JSON.stringify(plan, undefined, 4));

        const enableSubgraphDefer = req.headers['x-subgraph-defer'] !== 'false';

        const result = await execute(plan, variables, schema, enableSubgraphDefer);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(executeSync({
            document,
            schema,
            rootValue: result.data,
            variableValues: variables,
        })));
    })().catch((error) => {
        console.log(error);
        res.statusCode = 500;
        res.end(error.stack);
    });
});

server.listen(PORT);
