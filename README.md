# Federation Defer Proof Of Concept

This repository contains a proof of concept implementation of using `@defer` in requests to subgraphs as part of an [Apollo Federation](https://www.apollographql.com/docs/federation/) supergraph.

See this GitHub issue for relevant discussion: https://github.com/apollographql/federation/issues/2653

## Repository Parts
### Base

The `base` folder represents the base monolith example from [this GitHub comment](https://github.com/apollographql/federation/issues/2653#issuecomment-1712145052). To run the monolith application, enter the directory and run:
```sh
$ npm install
$ node index.js
```
This should then start the monolith example on port 8080.

This implementation is also able to be the subgraph for arbitrary subgraph definitions on its schema, allowing comparisons between different subgraph layouts without having to run more than one subgraph service.

### Defer POC router

The `defer-poc` folder represents a very quickly written implementation of a federated router. Expect it to be very buggy and lacking features.

To run the POC router, enter the directory and run:
```sh
$ npm install
$ node index.js ../supergraph/example.graphql
```

The argument passed to the program is the supergraph schema to use for queries.

When making a GraphQL request to the service, the header `x-subgraph-defer` can be set to `false` to disable the generation of `@defer`. This should always give similar performance to Apollo Router.

### Runtime Comparison Script

In the root directory there is an `index.js` file that will perform a runtime comparison between the implementations.

By default it expects the monolith on port 8080, Apollo Router on port 4000, and the POC Router on port 8090. Make sure that Apollo Router and the POC Router are both using the same supergraph SDL file when running a comparison.

It will run every `.graphql` file in the `queries` folder against all of the graphs, using the `.variables.json` file with the same prefix for variables.

To run Apollo Router, I recommend getting a binary in to this repository's folder, and running it with:
```sh
$ ./router --dev --supergraph supergraph/example.graphql
```

# Comparison Results:

## `example.graphql` Supergraph Schema
This file represents the example service distribution from [my GitHub comment](https://github.com/apollographql/federation/issues/2653#issuecomment-1712145052). This is in my opinion, a reasonable distribution of the fields to the services.

Using the `example.graphql` schema I get:
```sh
% node index.js
┌─────────┬──────────┬────────┬──────────────┬───────────┐
│ (index) │ Monolith │ Router │ POC-no-defer │ POC-defer │
├─────────┼──────────┼────────┼──────────────┼───────────┤
│ example │   5.08   │  7.05  │     7.06     │   5.06    │
└─────────┴──────────┴────────┴──────────────┴───────────┘
```

## `monolith.graphql` Supergraph Schema
This file represents a service distribution where there is only a single subgraph servicing all fields. In this case, all implementations should have the same performance.

Using the `monolith.graphql` schema I get:
```sh
% node index.js
┌─────────┬──────────┬────────┬──────────────┬───────────┐
│ (index) │ Monolith │ Router │ POC-no-defer │ POC-defer │
├─────────┼──────────┼────────┼──────────────┼───────────┤
│ example │   5.17   │  5.14  │     5.19     │   5.19    │
└─────────┴──────────┴────────┴──────────────┴───────────┘
```

## `service_per_field.graphql` Supergraph Schema
This file represents the opposite extreme: a service distribution where there is a subgraph for every field individually. In this case, all implementations should have the same performance.

Using the `service_per_field.graphql` schema I get:
```sh
% node index.js
┌─────────┬──────────┬────────┬──────────────┬───────────┐
│ (index) │ Monolith │ Router │ POC-no-defer │ POC-defer │
├─────────┼──────────┼────────┼──────────────┼───────────┤
│ example │   5.09   │  5.12  │     5.11     │   5.09    │
└─────────┴──────────┴────────┴──────────────┴───────────┘
```

## `worst_case.graphql` Supergraph Schema
This file represents a service layout chosen to maximize latency of the example query. I believe this to be the worst case. Even so, it is still a perfectly reasonable subgraph layout.

Using the `worst_case.graphql` schema I get:
```sh
% node index.js
┌─────────┬──────────┬────────┬──────────────┬───────────┐
│ (index) │ Monolith │ Router │ POC-no-defer │ POC-defer │
├─────────┼──────────┼────────┼──────────────┼───────────┤
│ example │   5.09   │  8.14  │     8.17     │   5.18    │
└─────────┴──────────┴────────┴──────────────┴───────────┘
```
