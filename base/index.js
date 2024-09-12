import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginInlineTrace } from '@apollo/server/plugin/inlineTrace';
import { startStandaloneServer } from '@apollo/server/standalone';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = new ApolloServer({
    typeDefs: `
        type Query {
            user(id: ID!): User # 1s
        }

        type User {
            id: ID! # 0s (Key fields are usually synchronous)
            name: String! # 1s
            profilePhoto: String! # 2s
        }

        # Federation subgraph support (partial)
        scalar _Any
        union _Entity =
         | User
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
            async user(_, { id }) {
                await delay(1000);
                return { id };
            },
            _entities(_, { representations }) {
                // Schema is written such that this should always be valid.
                return representations;
            },
        },
        User: {
            id: ({ id }) => id,
            async name({ id }) {
                await delay(1000);
                return `${id}-name`;
            },
            async profilePhoto({ id }) {
                await delay(2000);
                return `${id}-profilePhoto`;
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
