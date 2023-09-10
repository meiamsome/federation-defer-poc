import { Kind, isEnumType, isSchema, print } from 'graphql';
import { ID_SELECTION, PLAN_CHILD_OPERATION, PLAN_INITIAL_OPERATION } from './plan.js';

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

const executeSubgraphOperation = async (plan, entities, rootPlan, variableValues, schema) => {
    if (!isSchema(schema))
        throw new Error('schema is not a schema');
    console.log(`EXECUTING against ${plan.server}`);
    const isChild = plan.type === PLAN_CHILD_OPERATION;

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
                selectionSet: isChild ? wrapWithEntities(plan.selectionSet, plan.parentTypename) : plan.selectionSet,
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
            'content-type': 'application/json',
        },
    });
    if (!resp.ok)
        throw new Error(`Request to ${plan.server} failed: ${resp.status}\n${await resp.text()}`);
    const result = await resp.json();
    if (result.errors?.length)
        throw new Error(`Errors calling ${plan.server}:${result.errors.map(x => JSON.stringify(x)).join(`\n`)}`);

    console.timeEnd(`Request ${plan.id}: ${plan.server} (${url})`);

    await Promise.all(plan.children.map(async (childPlan) => {
        let currentData = [result.data];
        if (isChild)
            currentData = currentData.flatMap(x => x._entities)
        for (const path of childPlan.parentPath) {
            currentData = currentData.flatMap(x => x[path]);
        }
        if (childPlan.keySelection !== ID_SELECTION)
            throw new Error('Unimplemented');
        const entities = currentData.map((v) => ({
            __typename: childPlan.parentTypename,
            id: v.id,
        }));
        const childData = await executeSubgraphOperation(childPlan, entities, rootPlan, variableValues, schema);
        currentData.map((data, i) => Object.assign(data, childData._entities[i]));
    }));

    return result.data;
}


export const execute = async (rootPlan, variableValues, schema) => {
    if (!isSchema(schema))
        throw new Error('schema is not a schema');
    if ('representations' in variableValues)
        throw new Error("'representations' is a reserved variable name.");
    const results = await Promise.all(rootPlan.children.map((plan) => executeSubgraphOperation(plan, [], rootPlan, variableValues, schema)));
    return {
        data: results.reduce((objA, objB) => ({ ...objA, ...objB })),
    };
}
