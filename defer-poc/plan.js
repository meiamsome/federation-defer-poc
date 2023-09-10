import { Kind, TypeInfo, isSchema, visit, visitWithTypeInfo } from 'graphql';

export const PLAN_ROOT = 'PLAN_ROOT';
export const PLAN_INITIAL_OPERATION = 'PLAN_INITIAL_OPERATION';
export const PLAN_CHILD_OPERATION = 'PLAN_CHILD_OPERATION';

export const ID_SELECTION = {
    kind: Kind.FIELD,
    name: {
        kind: Kind.NAME,
        value: 'id',
    },
};

export const createPlan = (schema, document) => {
    if (!isSchema(schema))
        throw new Error('schema is not a schema');

    let planId = 0;
    const rootPlan = {
        type: PLAN_ROOT,
        server: null,
        children: [],
        variableDefinitions: {},
    };

    const planStack = [
        {
            plan: rootPlan,
        },
    ];

    let isInArgument = false;
    const typeInfo = new TypeInfo(schema);
    visit(
        document,
        visitWithTypeInfo(
            typeInfo,
            {
                OperationDefinition(doc) {
                    doc.operation
                },
                Argument: {
                    enter() {
                        isInArgument = true;
                    },
                    leave() {
                        isInArgument = false;
                    },
                },
                Variable: {
                    enter(variable) {
                        if (isInArgument) {
                            const currentPlan = planStack[planStack.length - 1];
                            if (![PLAN_INITIAL_OPERATION].includes(currentPlan.plan.type))
                                throw new Error('No variables outside of operations');
                            currentPlan.plan.variables[variable.name.value] = true;
                        }
                    },
                },
                VariableDefinition: {
                    enter(definition) {
                        if (planStack[planStack.length - 1].plan !== rootPlan)
                            throw new Error('Unreachable');
                        rootPlan.variableDefinitions[definition.variable.name.value] = definition;
                    }
                },
                Field: {
                    enter(fieldSelection) {
                        let currentPlan = planStack[planStack.length - 1];
                        const fieldName = fieldSelection.name.value;
                        console.log(`START ENTER ${fieldName} (${planStack[planStack.length - 1].path})`);
                        const type = typeInfo.getParentType();
                        const field = type.getFields()[fieldName];
                        if (!field)
                            throw new Error('field should be non-null');
                        let directives = field.astNode.directives.filter((directive) => directive.name.value === 'join__field');
                        if (directives.length > 1) {
                            const sameServerDirective = directives.find((directive) => directive.arguments.find((argument) => argument.name.value === 'graph').value.value === currentPlan.plan.server);
                            if (sameServerDirective) {
                                directives = [sameServerDirective];
                            }
                        }
                        if (directives.length === 0 && !planStack[planStack.length - 1].plan.server)
                            throw new Error(`Cannot infer parent server for field ${type.name}.${fieldName}`);
                        const server = directives.length
                            ? directives[0].arguments.find((argument) => argument.name.value === 'graph').value.value
                            : currentPlan.plan.server;

                        if (server !== currentPlan.plan.server) {
                            if (currentPlan.plan.type === PLAN_ROOT) {
                                const usablePlan = currentPlan.plan.children.find((plan) => plan.type === PLAN_INITIAL_OPERATION && plan.server === server);
                                const newPlan = usablePlan ?? {
                                    type: PLAN_INITIAL_OPERATION,
                                    id: planId++,
                                    server,
                                    variables: {},
                                    children: [],
                                    selectionSet: {
                                        kind: Kind.SELECTION_SET,
                                        selections: [],
                                    }
                                };
                                if (!usablePlan)
                                    currentPlan.plan.children.push(newPlan);
                                currentPlan = {
                                    plan: newPlan,
                                    selectionSets: [newPlan.selectionSet],
                                    path: [],
                                    fields: [],
                                };
                                planStack.push(currentPlan);
                            } else if ([PLAN_INITIAL_OPERATION, PLAN_CHILD_OPERATION].includes(currentPlan.plan.type)) {
                                console.log('Creating child operation');
                                // Append the key field to the parent. Assumes key field is always `id`.
                                const keySelection = ID_SELECTION;
                                const usablePlan = currentPlan.plan.children.find((plan) =>
                                    plan.type === PLAN_CHILD_OPERATION &&
                                    plan.server === server &&
                                    plan.parentTypename === type.name &&
                                    plan.parentPath.length === currentPlan.path.length &&
                                    plan.parentPath.every((pathPart, i) => pathPart === currentPlan.path[i]) &&
                                    // key selection should be the same by deep comparison, not object equality
                                    plan.keySelection === keySelection
                                )
                                const newPlan = usablePlan ?? {
                                    type: PLAN_CHILD_OPERATION,
                                    id: planId++,
                                    server,
                                    variables: {},
                                    children: [],
                                    selectionSet: {
                                        kind: Kind.SELECTION_SET,
                                        selections: [],
                                    },
                                    parentTypename: type.name,
                                    parentPath: [...currentPlan.path],
                                    parentSelection:  {
                                        kind: Kind.SELECTION_SET,
                                        selections: [currentPlan.fields.reduceRight(
                                            (subField, field) => ({
                                                ...field,
                                                selectionSet: {
                                                    kind: Kind.SELECTION_SET,
                                                    selections: [subField],
                                                },
                                            }),
                                            keySelection,
                                        )],
                                    },
                                    keySelection,
                                };
                                if (!usablePlan) {
                                    currentPlan.selectionSets[currentPlan.selectionSets.length - 1].selections.push(keySelection);
                                    currentPlan.plan.children.push(newPlan);
                                }
                                currentPlan = {
                                    plan: newPlan,
                                    selectionSets: [newPlan.selectionSet],
                                    path: [],
                                    fields: [],
                                };
                                planStack.push(currentPlan);
                            } else {
                                throw new Error('Unimplemented');
                            }
                        }

                        if (currentPlan.plan.type === PLAN_ROOT) {
                            throw new Error('Cannot add selection to a root plan');
                        }

                        const subgraphFieldSelection = {
                            kind: Kind.FIELD,
                            name: {
                                kind: Kind.NAME,
                                value: fieldSelection.name.value,
                            },
                            arguments: fieldSelection.arguments,
                            selectionSet: fieldSelection.selectionSet ? {
                                kind: Kind.SELECTION_SET,
                                selections: [],
                            } : undefined,
                        }
                        currentPlan.fields.push(subgraphFieldSelection);
                        currentPlan.selectionSets[currentPlan.selectionSets.length - 1].selections.push(subgraphFieldSelection);
                        if (fieldSelection.selectionSet) {
                            currentPlan.selectionSets.push(subgraphFieldSelection.selectionSet);
                            currentPlan.path.push(fieldName);
                        }
                        console.log(`END ENTER ${fieldName} (${planStack[planStack.length - 1].path})`);
                    },
                    leave(fieldSelection) {
                        const fieldName = fieldSelection.name.value;
                        console.log(`START LEAVE ${fieldName} (${planStack[planStack.length - 1].path})`);
                        const currentPlan = planStack[planStack.length - 1];
                        currentPlan.fields.pop();
                        if (fieldSelection.selectionSet) {
                            currentPlan.selectionSets.pop();
                            currentPlan.path.pop();
                        }
                        if (currentPlan.plan.type === PLAN_CHILD_OPERATION && currentPlan.path.length === 0)
                            console.log('Popped plan', planStack.pop());

                        console.log(`END LEAVE ${fieldName} (${planStack[planStack.length - 1].path})`);
                    }
                },
            },
        ),
    );

    return rootPlan;
}
