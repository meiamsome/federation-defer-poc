import { Kind, isEnumType, isSchema, print, visit } from 'graphql';
import { PLAN_CHILD_OPERATION } from './plan.js';

const getServerUrl = (server, schema) => {
    if (!isSchema(schema))
        throw new Error('schema is not a schema');
    const urlLookup = schema.getType('join__Graph');
    if (!isEnumType(urlLookup))
        throw new Error('Failed to find join__Graph');
    const serverDefinition = urlLookup.getValue(server);
    if (!serverDefinition)
        throw new Error(`Failed to find server ${server} (no enum variant)`);
    const directive = serverDefinition.astNode.directives.find((directive) => directive.name.value === 'join__graph');
    if (!directive)
        throw new Error(`Failed to find server ${server} (no directive)`);
    const urlVariable = directive.arguments.find((argument) => argument.name.value === 'url');
    if (!urlVariable)
        throw new Error(`Failed to find server ${server} (no url variable)`);
    const url = urlVariable.value.value;

    return url;
}

const REPRESENTATIONS_VARIABLE_DEFINITION = {
    kind: Kind.VARIABLE_DEFINITION,
    type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
            kind: Kind.LIST_TYPE,
            type: {
                kind: Kind.NON_NULL_TYPE,
                type: {
                    kind: Kind.NAMED_TYPE,
                    name: {
                        kind: Kind.NAME,
                        value: '_Any',
                    },
                },
            },
        },
    },
    variable: {
        kind: Kind.VARIABLE,
        name: {
            kind: Kind.NAME,
            value: 'representations',
        },
    },
};

const wrapWithEntities = (selectionSet, typename) => ({
    kind: Kind.SELECTION_SET,
    selections: [{
        kind: Kind.FIELD,
        name: {
            kind: Kind.NAME,
            value: '_entities',
        },
        arguments: [
            {
                kind: Kind.ARGUMENT,
                name: {
                    kind: Kind.NAME,
                    value: 'representations',
                },
                value: {
                    kind: Kind.VARIABLE,
                    name: {
                        kind: Kind.NAME,
                        value: 'representations',
                    },
                },
            },
        ],
        selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [{
                kind: Kind.INLINE_FRAGMENT,
                typeCondition: {
                    kind: Kind.NAMED_TYPE,
                    name: {
                        kind: Kind.NAME,
                        value: typename,
                    },
                },
                selectionSet,
            }],
        },
    }]
});

const wrapWithInlineFragment = (selectionSet) => ({
    kind: Kind.INLINE_FRAGMENT,
    selectionSet,
})

const wrapWithDefer = (selectionSet, label) => ({
    kind: Kind.INLINE_FRAGMENT,
    directives: [{
        kind: Kind.DIRECTIVE,
        name: {
            kind: Kind.NAME,
            value: 'defer',
        },
        arguments: [{
            kind: Kind.ARGUMENT,
            name: {
                kind: Kind.NAME,
                value: 'label',
            },
            value: {
                kind: Kind.STRING,
                value: label,
            },
        }],
    }],
    selectionSet,
});

const selectValue = (value, selectionSet) => {
    const result = {};
    const resultStack = [result];
    const valueStack = [value];
    visit(
        selectionSet,
        {
            Field: {
                enter(fieldNode) {
                    const name = fieldNode.name.value;
                    const currentResult = resultStack[resultStack.length - 1];
                    const currentValue = valueStack[valueStack.length - 1];
                    if (fieldNode.selectionSet) {
                        currentResult[name] = {};
                    } else {
                        currentResult[name] = currentValue[name];
                    }
                    resultStack.push(currentResult[name]);
                    valueStack.push(currentValue[name]);
                },
                leave(fieldNode) {
                    resultStack.pop();
                    valueStack.pop();
                }
            }
        }
    );
    return result;
}

async function* multipartReader(reader, boundary) {
    const utf8Decoder = new TextDecoder("utf-8");
    let hasFirstBoundary = false;
    let boundarySearchOffset = 0;
    let data = '';
    let isDone = false;
    while(!isDone) {
        const {
            done,
            value,
        } = await reader.read();
        isDone = done;
        if (value)
            data += utf8Decoder.decode(value, { stream: !done });

        while (true) {
            const nextBoundary = data.indexOf(boundary, boundarySearchOffset);
            if (nextBoundary === -1) {
                boundarySearchOffset = data.length - boundary.length;
                break;
            }
            const thisData = data.slice(0, nextBoundary);
            data = data.slice(nextBoundary + boundary.length);
            if (!hasFirstBoundary) {
                hasFirstBoundary = true;
            } else {
                yield thisData;
            }

            boundarySearchOffset = 0;
        }
    }
    if (data !== '--\r\n')
        throw new Error('Multipart end failure.');
}

const executeSubgraphOperation = async (plan, entities, rootPlan, variableValues, schema, enableSubgraphDefer) => {
    if (!isSchema(schema))
        throw new Error('schema is not a schema');
    console.log(`EXECUTING against ${plan.server}`);
    const isChild = plan.type === PLAN_CHILD_OPERATION;

    const deferResolves = {};
    const deferRejects = {};
    const deferPromises = {};
    const createDefer = (name) => {
        deferPromises[name] = new Promise((resolve, reject) => {
            deferResolves[name] = resolve;
            deferRejects[name] = reject;
        });
        return deferPromises[name];
    }

    const resultPromise = createDefer('result');
    const resultSelectionSet = isChild
        ? wrapWithEntities(plan.selectionSet, plan.parentTypename)
        : plan.selectionSet;
    const selectionSet = {
        kind: Kind.SELECTION_SET,
        selections:
            plan.children.length
                ? [
                    enableSubgraphDefer
                        ? wrapWithDefer(
                            resultSelectionSet,
                            'result',
                        )
                        : wrapWithInlineFragment(resultSelectionSet),
                    ...plan.children.map((childPlan, i) => {
                        let childSelection = childPlan.parentSelection;
                        if (isChild)
                            childSelection = wrapWithEntities(childSelection, plan.parentTypename)

                        createDefer(`child-${i}`);
                        if (enableSubgraphDefer)
                            return wrapWithDefer(childSelection, `child-${i}`);
                        return wrapWithInlineFragment(childSelection);
                    }),
                ]
                : [{
                    kind: Kind.INLINE_FRAGMENT,
                    selectionSet: resultSelectionSet,
                }],
    };

    const childrenRequests = plan.children.map(async (childPlan, i) => {
        let currentData = [await deferPromises[`child-${i}`]];
        if (isChild)
            currentData = currentData.flatMap(x => x._entities)
        for (const path of childPlan.parentPath) {
            currentData = currentData.flatMap(x => x[path]);
        }
        const entities = currentData.map((v) => ({
            __typename: childPlan.parentTypename,
            ...selectValue(v, childPlan.keySelection),
        }));
        return {
            path: childPlan.parentPath,
            childData: await executeSubgraphOperation(childPlan, entities, rootPlan, variableValues, schema, enableSubgraphDefer),
        };
    })

    const document = {
        kind: Kind.DOCUMENT,
        definitions: [
            {
                kind: Kind.OPERATION_DEFINITION,
                operation: 'query',
                variableDefinitions: [
                    ...Object.keys(plan.variables).map((variable) => rootPlan.variableDefinitions[variable]),
                    ...(isChild ? [REPRESENTATIONS_VARIABLE_DEFINITION] : [])
                ],
                selectionSet,
            },
        ],
    };
    const query = print(document);
    console.log(query);
    const url = getServerUrl(plan.server, schema);
    console.time(`Request ${plan.id}: ${plan.server} (${url})`);
    const resp = await fetch(url, {
        body: JSON.stringify({
            query,
            variables: Object.fromEntries(
                [
                    ...Object.keys(plan.variables).map((variable) => [variable, variableValues[variable]]),
                    ...(isChild ? [['representations', entities]] : []),
                ],
            ),
        }),
        method: 'POST',
        headers: {
            'accept': 'multipart/mixed; deferSpec=20220824, application/json',
            'content-type': 'application/json',
        },
    });
    if (!resp.ok)
        throw new Error(`Request to ${plan.server} failed: ${resp.status}\n${await resp.text()}`);

    const contentType = resp.headers.get('content-type');
    if (contentType.startsWith('multipart/mixed;')) {
        const multipartData = Object.fromEntries(
            contentType.split(';')
                .slice(1)
                .map(part => part.trim().split('=')),
        );
        if (multipartData['deferSpec'] !== '20220824')
            throw new Error('Mismatched deferSpec!');
        const boundary = `--${multipartData['boundary'].slice(1, -1)}`;
        const reader = resp.body.getReader();

        for await (const partData of multipartReader(reader, boundary)) {
            const lines = partData.trim().split('\r\n\r\n');
            if (lines.length !== 2)
                throw new Error('Unexpected line length in multipart');
            if (lines[0] !== 'content-type: application/json; charset=utf-8')
                throw new Error('Unexpected part header')
            const part = JSON.parse(lines[1]);
            if (part.errors)
                throw new Error(`Errors calling ${plan.server}:${part.errors.map(x => JSON.stringify(x)).join(`\n`)}`);

            if ('data' in part) {
                // Initial response ignored
            } else {
                if (!('incremental' in part))
                    throw new Error('No incremental pieces');
                for (const incrementalPart of part.incremental) {
                    if (incrementalPart.errors) {
                        deferRejects[incrementalPart.label](new Error(`Errors calling ${plan.server}:${incrementalPart.errors.map(x => JSON.stringify(x)).join(`\n`)}`));
                    } else {
                        deferResolves[incrementalPart.label](incrementalPart.data);
                    }
                    delete deferRejects[incrementalPart.label];
                    delete deferResolves[incrementalPart.label];
                }
            }
        }

    } else if (contentType.startsWith('application/json')) {
        const result = await resp.json();
        if (result.errors?.length)
            throw new Error(`Errors calling ${plan.server}:${result.errors.map(x => JSON.stringify(x)).join(`\n`)}`);
        for (const unresolvedDeferredPromises of Object.keys(deferResolves)) {
            deferResolves[unresolvedDeferredPromises](result.data);
            delete deferResolves[unresolvedDeferredPromises];
            delete deferRejects[unresolvedDeferredPromises];
        }
    } else {
        throw new Error(`Unacceptable response type ${contentType}`);
    }

    const data = await resultPromise;
    console.timeEnd(`Request ${plan.id}: ${plan.server} (${url})`);
    for (const [unresolved, resolve] of Object.entries(deferResolves)) {
        console.warn(`Child key unresolved ${unresolved}`);
        resolve(data);
    }

    for (const { path, childData } of await Promise.all(childrenRequests)) {
        let targets = [data];
        if (isChild)
            targets = targets.flatMap(x => x._entities)
        for (const pathPart of path) {
            targets = targets.flatMap(x => x[pathPart]);
        }
        targets.map((target, i) => Object.assign(target, childData._entities[i]));
    }

    return data;
}


export const execute = async (rootPlan, variableValues, schema, enableSubgraphDefer) => {
    if (!isSchema(schema))
        throw new Error('schema is not a schema');
    if ('representations' in variableValues)
        throw new Error("'representations' is a reserved variable name.");
    const results = await Promise.all(rootPlan.children.map((plan) => executeSubgraphOperation(plan, [], rootPlan, variableValues, schema, enableSubgraphDefer)));
    return {
        data: results.reduce((objA, objB) => ({ ...objA, ...objB })),
    };
}
