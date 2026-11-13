import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

const zodTransformer: InputTransformerFn = (config) => {
  titleTransformer(config);

  const nameSchema = config.components?.schemas?.ShoppingListInput?.properties?.name;
  if (nameSchema && typeof nameSchema === "object" && !Array.isArray(nameSchema)) {
    // JSON Schema maxLength counts Unicode code points, while Zod's max counts
    // UTF-16 code units. Keep maxLength in the published contract, but generate
    // the equivalent code-point-aware validator for the Zod client.
    delete nameSchema.maxLength;
    nameSchema.pattern = "^(?:[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[\\s\\S]){1,100}$";
  }

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: "custom-fetch.ts",
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: zodTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          version: 3,
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        operations: {
          createShoppingList: {
            zod: {
              preprocess: {
                body: {
                  path: "shopping-list-name-preprocessor.ts",
                  name: "preprocessShoppingListNameBody",
                },
              },
            },
          },
          updateShoppingList: {
            zod: {
              preprocess: {
                body: {
                  path: "shopping-list-name-preprocessor.ts",
                  name: "preprocessShoppingListNameBody",
                },
              },
            },
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
