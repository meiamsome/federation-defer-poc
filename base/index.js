import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginInlineTrace } from '@apollo/server/plugin/inlineTrace';
import { startStandaloneServer } from '@apollo/server/standalone';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = new ApolloServer({
    typeDefs: `
        type Query {
            product(id: ID!): Product # 1s
        }

        type Product {
            id: ID! # 0s (Key fields are usually synchronous)
            manufacturer: Company! # 1s
            countryOfOrigin: Country! # 2s
            inStock: Boolean! # 3s
        }

        type Company {
            id: ID! # 0s
            name: String! # 2s
            owner: Person! # 1s
        }

        type Person {
            id: ID! # 0s
            name: String! # 1s
        }

        type Country {
            id: ID! # 0s
            name: String! # 2s
        }

        # Federation subgraph support (partial)
        scalar _Any
        union _Entity =
         | Product
         | Company
         | Person
         | Country
        extend type Query {
            _entities(representations: [_Any!]!): [_Entity]!
        }

        # Support @defer
        directive @defer(
            label: String
            if: Boolean! = true
        ) on FRAGMENT_SPREAD | INLINE_FRAGMENT
    `,
    resolvers: {
        Query: {
            async product(_, { id }) {
                await delay(1000);
                return { id };
            },
            _entities(_, { representations }) {
                // Schema is written such that this should always be valid.
                return representations;
            },
        },
        Product: {
            id: ({ id }) => id,
            async manufacturer({ id }) {
                await delay(1000);
                return {
                    id: `${id}-company`,
                };
            },
            async countryOfOrigin({ id }) {
                await delay(2000);
                return {
                    id: `${id}-country`,
                };
            },
            async inStock({ id }) {
                await delay(3000);
                return Boolean(
                    Array.from(id)
                        .map(x => x.charCodeAt(0))
                        .reduce((a, b) => a ^ b) & 0x1
                );
            },
        },
        Company: {
            id: ({ id }) => id,
            async name({ id }) {
                await delay(2000);
                return `${id}-name`;
            },
            async owner({ id }) {
                await delay(1000);
                return {
                    id: `${id}-owner`,
                };
            },
        },
        Person: {
            id: ({ id }) => id,
            async name({ id }) {
                await delay(1000);
                return `${id}-name`;
            },
        },
        Country: {
            id: ({ id }) => id,
            async name({ id }) {
                await delay(2000);
                return `${id}-name`;
            },
        },
    },
    plugins: [ApolloServerPluginInlineTrace()],
});

const { url } = await startStandaloneServer(server, {
    listen: {
        port: 8080,
    },
});
console.log(`Server started at ${url}`);
