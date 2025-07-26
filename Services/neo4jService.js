
import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'your_neo4j_password')
);

const session = driver.session();

export async function queryNodeById(id) {
  const query = `
    MATCH (n {id: $id})
    RETURN n LIMIT 1
  `;
  const params = { id };
  const result = await session.run(query, params);

  if (result.records.length > 0) {
    return result.records[0].get('n').properties;
  }
  return null;
}

export async function close() {
  await session.close();
  await driver.close();
}
