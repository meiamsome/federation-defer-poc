**NOTE**: This branch is specifically for the issue here: https://github.com/apollographql/federation/issues/3141

Please see the [main branch](https://github.com/meiamsome/federation-defer-poc?tab=readme-ov-file#federation-defer-proof-of-concept) for information about what this repository is.

## Repository Parts
See the [main branch](https://github.com/meiamsome/federation-defer-poc?tab=readme-ov-file#repository-parts).

# Comparison Results:

## `monolith_and_new_subgraph.graphql` Supergraph Schema
This file represents the described current situation in the opening post of the issue.

Using the `monolith_and_new_subgraph.graphql` schema I get:
```sh
┌─────────┬──────────┬───────────────┬──────────────┬───────────┐
│ (index) │ Monolith │ Apollo Router │ POC-no-defer │ POC-defer │
├─────────┼──────────┼───────────────┼──────────────┼───────────┤
│ example │ 3.05     │ 4.06          │ 4.08         │ 3.09      │
└─────────┴──────────┴───────────────┴──────────────┴───────────┘
```

Which shows the POC defer approach to be effective in this use case.

## `split_monolith.graphql` Supergraph Schema
This file represents my suggested Stopgap Solution in this comment: https://github.com/apollographql/federation/issues/3141#issuecomment-2345250951

This fakes the monolith as two services to force a federation hop after `Query.user` in all cases.

Using the `split_monolith.graphql` schema I get:
```sh
┌─────────┬──────────┬───────────────┬──────────────┬───────────┐
│ (index) │ Monolith │ Apollo Router │ POC-no-defer │ POC-defer │
├─────────┼──────────┼───────────────┼──────────────┼───────────┤
│ example │ 3.06     │ 3.05          │ 3.09         │ 3.09      │
└─────────┴──────────┴───────────────┴──────────────┴───────────┘
```

Which shows that by faking a service split in the monolith, the full performance can be obtained without a change to the router.
