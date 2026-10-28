/**
 * Static check of the built-in data hook queries against the GraphQL schema.
 *
 * `graphql` is not a dependency of this package, so the check runs against a
 * snapshot instead of graphql-js `validate()`: `fixtures/graphql-schema-snapshot.json`
 * holds, per role, every type the queries touch (all fields with their argument
 * types) printed from `getSchemaForRole(role)` in waffo-pancake-graphql-service.
 * The `customer` role stands for customer session tokens (its schema is identical
 * to `buyer`); merchant queries use `merchant`.
 *
 * When a query selects a new type, or the schema changes, regenerate the snapshot
 * from graphql-service with graphql-js (`printSchema` per role, trimmed to the
 * touched types) and confirm the queries with `validate()` there.
 */
import { describe, it, expect } from "vitest";

import { CUSTOMER_ORDERS_QUERY, CUSTOMER_PAYMENTS_QUERY, CUSTOMER_REFUND_TICKETS_QUERY } from "../use-customer-data.js";
import { MERCHANT_ORDERS_QUERY, MERCHANT_SALES_QUERY, MERCHANT_SUBSCRIPTIONS_QUERY } from "../use-merchant-data.js";
import snapshot from "./fixtures/graphql-schema-snapshot.json";

// ============================================================
// Snapshot model
// ============================================================

interface ObjectTypeSnapshot {
  kind: "OBJECT";
  fields: Record<string, { type: string; args: Record<string, string> }>;
}

interface InputTypeSnapshot {
  kind: "INPUT_OBJECT";
  fields: Record<string, string>;
}

interface RoleSnapshot {
  types: Record<string, ObjectTypeSnapshot | InputTypeSnapshot>;
  kinds: Record<string, string>;
}

const ROLES = snapshot.roles as unknown as Record<"customer" | "merchant", RoleSnapshot>;

const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

// ============================================================
// Minimal query parser (operations, variables, fields, arguments)
// ============================================================

type ArgValue = { kind: "variable"; name: string } | { kind: "int" } | { kind: "string" } | { kind: "enum"; value: string };

interface FieldNode {
  name: string;
  args: Record<string, ArgValue>;
  selections: FieldNode[] | null;
}

interface OperationNode {
  variables: Record<string, string>;
  selections: FieldNode[];
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  const re = /\s+|,|#[^\n]*|([{}():!$[\]])|([_A-Za-z][_0-9A-Za-z]*)|(-?\d+)|("(?:[^"\\]|\\.)*")/gy;
  let match: RegExpExecArray | null;
  while (re.lastIndex < source.length) {
    const at = re.lastIndex;
    match = re.exec(source);
    if (!match) throw new Error(`Unexpected character at ${at}: ${source.slice(at, at + 20)}`);
    const token = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

function parseOperation(source: string): OperationNode {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const next = (): string => {
    const token = tokens[pos++];
    if (token === undefined) throw new Error("Unexpected end of query");
    return token;
  };
  const expect = (token: string): void => {
    const got = next();
    if (got !== token) throw new Error(`Expected "${token}", got "${got}"`);
  };

  const parseType = (): string => {
    let type: string;
    if (peek() === "[") {
      next();
      type = `[${parseType()}]`;
      expect("]");
    } else {
      type = next();
    }
    if (peek() === "!") {
      next();
      type += "!";
    }
    return type;
  };

  const parseValue = (): ArgValue => {
    const token = next();
    if (token === "$") return { kind: "variable", name: next() };
    if (/^-?\d+$/.test(token)) return { kind: "int" };
    if (token.startsWith('"')) return { kind: "string" };
    return { kind: "enum", value: token };
  };

  const parseSelections = (): FieldNode[] => {
    expect("{");
    const fields: FieldNode[] = [];
    while (peek() !== "}") {
      const name = next();
      const args: Record<string, ArgValue> = {};
      if (peek() === "(") {
        next();
        while (peek() !== ")") {
          const argName = next();
          expect(":");
          args[argName] = parseValue();
        }
        next();
      }
      fields.push({ name, args, selections: peek() === "{" ? parseSelections() : null });
    }
    next();
    return fields;
  };

  expect("query");
  const variables: Record<string, string> = {};
  if (peek() !== "(" && peek() !== "{") next();
  if (peek() === "(") {
    next();
    while (peek() !== ")") {
      expect("$");
      const name = next();
      expect(":");
      variables[name] = parseType();
    }
    next();
  }
  const selections = parseSelections();
  if (pos !== tokens.length) throw new Error(`Unexpected token after operation: "${peek()}"`);
  return { variables, selections };
}

// ============================================================
// Validation against the snapshot
// ============================================================

function namedType(type: string): string {
  return type.replace(/[[\]!]/g, "");
}

function kindOf(role: RoleSnapshot, name: string): string | undefined {
  return BUILTIN_SCALARS.has(name) ? "SCALAR" : role.kinds[name];
}

/** A variable of type `variableType` may be passed where `argType` is expected */
function isVariableTypeAllowed(variableType: string, argType: string): boolean {
  return variableType === argType || variableType === `${argType}!`;
}

function validateQuery(roleName: "customer" | "merchant", source: string): string[] {
  const role = ROLES[roleName];
  const operation = parseOperation(source);
  const errors: string[] = [];
  const usedVariables = new Set<string>();

  for (const [name, type] of Object.entries(operation.variables)) {
    const kind = kindOf(role, namedType(type));
    if (kind !== "SCALAR" && kind !== "ENUM" && kind !== "INPUT_OBJECT") {
      errors.push(`Variable "$${name}" has unknown input type "${type}".`);
    }
  }

  const visit = (parentType: string, fields: FieldNode[]): void => {
    const parent = role.types[parentType];
    if (!parent || parent.kind !== "OBJECT") {
      errors.push(`Type "${parentType}" is not in the ${roleName} schema snapshot.`);
      return;
    }
    for (const field of fields) {
      const def = parent.fields[field.name];
      if (!def) {
        errors.push(`Cannot query field "${field.name}" on type "${parentType}".`);
        continue;
      }
      for (const [argName, value] of Object.entries(field.args)) {
        const argType = def.args[argName];
        if (!argType) {
          errors.push(`Unknown argument "${argName}" on field "${parentType}.${field.name}".`);
          continue;
        }
        if (value.kind === "variable") {
          usedVariables.add(value.name);
          const variableType = operation.variables[value.name];
          if (!variableType) errors.push(`Variable "$${value.name}" is not defined.`);
          else if (!isVariableTypeAllowed(variableType, argType)) {
            errors.push(`Variable "$${value.name}" of type "${variableType}" used in position expecting type "${argType}".`);
          }
        } else if (value.kind === "int" && namedType(argType) !== "Int") {
          errors.push(`Int literal passed to "${parentType}.${field.name}(${argName}: ${argType})".`);
        }
      }
      for (const [argName, argType] of Object.entries(def.args)) {
        if (argType.endsWith("!") && !(argName in field.args)) {
          errors.push(`Field "${field.name}" argument "${argName}" of type "${argType}" is required, but it was not provided.`);
        }
      }
      const returnType = namedType(def.type);
      const kind = kindOf(role, returnType);
      if (kind === "OBJECT") {
        if (!field.selections) errors.push(`Field "${parentType}.${field.name}" of type "${def.type}" must have a selection of subfields.`);
        else visit(returnType, field.selections);
      } else if (field.selections) {
        errors.push(`Field "${parentType}.${field.name}" must not have a selection since type "${def.type}" has no subfields.`);
      }
    }
  };

  visit("Query", operation.selections);

  for (const name of Object.keys(operation.variables)) {
    if (!usedVariables.has(name)) errors.push(`Variable "$${name}" is never used.`);
  }
  return errors;
}

/** Check a variable value against an input object type of the snapshot */
function validateInputValue(roleName: "customer" | "merchant", typeName: string, value: Record<string, unknown>): string[] {
  const type = ROLES[roleName].types[typeName];
  if (!type || type.kind !== "INPUT_OBJECT") return [`Input type "${typeName}" is not in the ${roleName} schema snapshot.`];
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!(key in type.fields)) errors.push(`Field "${key}" is not defined by type "${typeName}".`);
  }
  for (const [key, fieldType] of Object.entries(type.fields)) {
    const fieldValue = value[key];
    if (fieldType.endsWith("!") && fieldValue === undefined)
      errors.push(`Field "${typeName}.${key}" of required type "${fieldType}" was not provided.`);
    const nested = namedType(fieldType);
    if (fieldValue !== undefined && ROLES[roleName].kinds[nested] === "INPUT_OBJECT") {
      errors.push(...validateInputValue(roleName, nested, fieldValue as Record<string, unknown>));
    }
  }
  return errors;
}

// ============================================================
// Tests
// ============================================================

describe("built-in data hook queries match the GraphQL schema", () => {
  it.each([
    ["customer", "CUSTOMER_ORDERS_QUERY", CUSTOMER_ORDERS_QUERY],
    ["customer", "CUSTOMER_PAYMENTS_QUERY", CUSTOMER_PAYMENTS_QUERY],
    ["customer", "CUSTOMER_REFUND_TICKETS_QUERY", CUSTOMER_REFUND_TICKETS_QUERY],
    ["merchant", "MERCHANT_ORDERS_QUERY", MERCHANT_ORDERS_QUERY],
    ["merchant", "MERCHANT_SALES_QUERY", MERCHANT_SALES_QUERY],
    ["merchant", "MERCHANT_SUBSCRIPTIONS_QUERY", MERCHANT_SUBSCRIPTIONS_QUERY],
  ] as const)("%s role accepts %s", (role, _name, query) => {
    expect(validateQuery(role, query)).toEqual([]);
  });

  it("customer order lists take storeId / storeSlug, payments take storeId", () => {
    const query = (ROLES.customer.types.Query as ObjectTypeSnapshot).fields;
    expect(query.onetimeOrders.args).toMatchObject({ storeId: "String", storeSlug: "String" });
    expect(query.subscriptionOrders.args).toMatchObject({ storeId: "String", storeSlug: "String" });
    expect(query.payments.args).toMatchObject({ storeId: "String" });
    expect(query.payments.args).not.toHaveProperty("storeSlug");
  });

  it("merchant sales filter matches AnalyticsFilterInput", () => {
    expect(
      validateInputValue("merchant", "AnalyticsFilterInput", { timeRange: { startDate: "2026-10-01", endDate: "2026-11-01" } }),
    ).toEqual([]);
    expect(validateInputValue("merchant", "AnalyticsFilterInput", {})).toEqual([
      'Field "AnalyticsFilterInput.timeRange" of required type "TimeRangeInput!" was not provided.',
    ]);
  });
});

describe("schema check catches the incompatibilities it guards against", () => {
  it("rejects removed fields and wrong variable types", () => {
    const stale = `query ($storeId: ID!) {
      subscriptionOrders(storeId: $storeId) {
        id cancelAt
        product { id name }
        payments { id snapshotDisplayAmount }
      }
    }`;
    expect(validateQuery("merchant", stale)).toEqual([
      'Variable "$storeId" of type "ID!" used in position expecting type "String".',
      'Cannot query field "cancelAt" on type "SubscriptionOrder".',
      'Cannot query field "product" on type "SubscriptionOrder".',
      'Cannot query field "snapshotDisplayAmount" on type "Payment".',
    ]);
  });

  it("rejects a missing required argument, missing subfields and unused variables", () => {
    const stale = `query ($storeId: String, $unused: Int) {
      orderStatistics(storeId: $storeId) { totalCount countByStatus { status count } buyerMetrics }
      payments(storeSlug: $storeId) { id amount }
    }`;
    expect(validateQuery("merchant", stale)).toEqual([
      'Field "orderStatistics" argument "filter" of type "AnalyticsFilterInput!" is required, but it was not provided.',
      'Cannot query field "countByStatus" on type "OrderStatistics".',
      'Field "OrderStatistics.buyerMetrics" of type "BuyerMetrics!" must have a selection of subfields.',
      'Cannot query field "payments" on type "Query".',
      'Variable "$unused" is never used.',
    ]);
  });

  it("rejects fields hidden from the customer role", () => {
    expect(validateQuery("customer", "query { payments { id settlementAmount } }")).toEqual([
      'Cannot query field "settlementAmount" on type "Payment".',
    ]);
  });
});
