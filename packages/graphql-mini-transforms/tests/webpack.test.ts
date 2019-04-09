import * as path from 'path';
import {createHash} from 'crypto';
import {loader} from 'webpack';
import {stripIndent} from 'common-tags';

import graphQLLoader from '../src/webpack';

describe('graphql-mini-transforms/webpack', () => {
  it('marks the loader as cacheable', async () => {
    const loader = createLoaderContext();
    const cacheableSpy = jest.spyOn(loader, 'cacheable');

    await simulateRun(`query Shop { shop { id } }`, loader);

    expect(cacheableSpy).toHaveBeenCalled();
  });

  it('exports the document as the default export', async () => {
    expect(await simulateRun(`query Shop { shop { id } }`)).toMatch(
      /^export default /,
    );
  });

  it('removes locations for all nodes other than the document', async () => {
    expect(
      await extractDocumentExport(`query Shop { shop }`),
    ).not.toHaveProperty('definitions.0.loc');
  });

  it('exposes the source on the document', async () => {
    expect(
      await extractDocumentExport(`query Shop { shop { id } }`),
    ).toHaveProperty('loc.source.body', expect.any(String));
  });

  it('adds typenames to selection sets', async () => {
    expect(
      await extractDocumentExport(`query Shop { shop { id } }`),
    ).toHaveProperty('loc.source.body', expect.stringContaining('__typename'));
  });

  it('minifies the source', async () => {
    const originalSource = stripIndent`
      # Comments should go away
      # As should extra space
      query Shop ( $id : ID! , $first: Number! ) {
        # Most whitespace should go too
        shop ( id:   $id, first: $first ) {
          # Should also minify selection sets
          id,
          name,
        }
      }
    `;

    const expectedSource = `query Shop($id:ID!,$first:Number!){shop(id:$id,first:$first){id name __typename}}`;

    expect(await extractDocumentExport(originalSource)).toHaveProperty(
      'loc.source.body',
      expectedSource,
    );
  });

  it('adds an ID property that is a sha256 hash of the query document', async () => {
    const result = await extractDocumentExport(`query Shop { shop { id } }`);
    expect(result).toHaveProperty(
      'id',
      createHash('sha256')
        .update(result.loc.source.body)
        .digest('hex'),
    );
  });

  describe('import', () => {
    it('adds the resolved import as a dependency', async () => {
      const context = '/app/';
      const imported = './FooFragment.graphql';
      const resolvedPath = path.resolve(imported);

      const loader = createLoaderContext({
        context,
        resolve: () => resolvedPath,
        readFile: () => `fragment FooFragment on Shop { id }`,
      });

      const resolveSpy = jest.spyOn(loader, 'resolve');
      const addDependencySpy = jest.spyOn(loader, 'addDependency');

      await simulateRun(
        stripIndent`
          #import '${imported}';

          query Shop {
            shop {
              ...FooFragment
            }
          }
        `,
        loader,
      );

      expect(resolveSpy).toHaveBeenCalledWith(
        context,
        imported,
        expect.any(Function),
      );

      expect(addDependencySpy).toHaveBeenCalledWith(resolvedPath);
    });

    it('includes imported sources if they are used', async () => {
      const context = '/app/';
      const loader = createLoaderContext({
        context,
        readFile: () => `fragment FooFragment on Shop { id }`,
      });

      const {
        loc: {
          source: {body},
        },
      } = await extractDocumentExport(
        stripIndent`
          #import './FooFragment.graphql';

          query Shop {
            shop {
              ...FooFragment
            }
          }
        `,
        loader,
      );

      expect(body).toContain('...FooFragment');
      expect(body).toContain('fragment FooFragment on Shop');
    });

    it('excludes imported sources if they are not used', async () => {
      const context = '/app/';
      const loader = createLoaderContext({
        context,
        readFile: () => `fragment FooFragment on Shop { id }`,
      });

      const {
        loc: {
          source: {body},
        },
      } = await extractDocumentExport(
        stripIndent`
        #import './FooFragment.graphql';

        query Shop {
          shop {
            id
          }
        }
      `,
        loader,
      );

      expect(body).not.toContain('fragment FooFragment on Shop');
    });
  });
});

interface Options {
  context?: string;
  resolve?(context: string, imported: string): string | Error;
  readFile?(file: string): string | Error;
}

// This is a limited subset of the loader API that we actually use in our
// loader.
function createLoaderContext({
  context = __dirname,
  readFile = () => '',
  resolve = (context, imported) => path.resolve(context, imported),
}: Options = {}): loader.LoaderContext {
  return {
    context,
    fs: {
      readFile(
        file: string,
        withFile: (error: Error | null, result?: string) => void,
      ) {
        const read = readFile(file);

        if (typeof read === 'string') {
          withFile(null, read);
        } else {
          withFile(read);
        }
      },
    },
    cacheable() {},
    async() {
      return () => {};
    },
    resolve(
      context: string,
      imported: string,
      withResolved: (error: Error | null, result?: string) => void,
    ) {
      const resolved = resolve(context, imported);

      if (typeof resolved === 'string') {
        withResolved(null, resolved);
      } else {
        withResolved(resolved);
      }
    },
    addDependency() {},
  } as any;
}

async function extractDocumentExport(
  source: string,
  loader = createLoaderContext(),
) {
  const result = await simulateRun(source, loader);
  return JSON.parse(result.replace(/^export default /, '').replace(/;$/, ''));
}

function simulateRun(source: string, loader = createLoaderContext()) {
  return new Promise<string>((resolve, reject) => {
    Reflect.defineProperty(loader, 'async', {
      value: () => (error: Error | null, result?: string) => {
        if (error == null) {
          resolve(result || '');
        } else {
          reject(error);
        }
      },
    });

    graphQLLoader.call(loader, source);
  });
}
