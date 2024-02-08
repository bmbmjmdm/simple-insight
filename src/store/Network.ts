import { PineconeKey, PineconeServer } from '../secrets'

type PineconeFetch = {
  endpoint: string;
  body?: Object;
  secondTry?: boolean; 
}

// helper function that makes a fetch call to our pinecone server, returns the json response or null if it fails
// has a built-in retry
const pineconeFetch = async (props: PineconeFetch): Promise<any> => {
  const { endpoint, body, secondTry } = props
  try {
    const result = await fetch(`${PineconeServer}/${endpoint}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'Api-Key': PineconeKey
      },
      body: body ? JSON.stringify(body) : undefined
    })
    if (result.status !== 200) throw new Error(`Pinecone fetch failed with status ${result.status}`)
    const json = await result.json()
    return json
  }
  catch (e) {
    console.log(`${endpoint} failed`)
    console.log(e)
    if (secondTry) return null
    else return await pineconeFetch({endpoint, body, secondTry: true})
  }
}

// calls our index and sees if it has at least 1 vector, returns true or false (defaults to false if it fails)
export const checkIndex = async (): Promise<boolean> => {
  try {
    const result = await pineconeFetch({endpoint: "describe_index_stats"})
    if (!result) return false
    return result['totalVectorCount'] > 0
  }
  catch (e) {
    return false
  }
}

// calls our index and deletes all vectors, returns true if successful
export const clearIndex = async (): Promise<boolean> => {
  try {
    await pineconeFetch({
      endpoint: "vectors/delete",
      body: { deleteAll: true }
    })
    return true
  }
  catch (e) {
    return false
  }
}

export type Vector = {
  metadata: {
    text: string,
  };
  values: number[];
}

// calls our index and deletes all vectors, returns true if successful
export const populateIndex = async (vectors: Vector[]): Promise<boolean> => {
  try {
    await pineconeFetch({
      endpoint: "vectors/upsert",
      body: { vectors }
    })
    return true
  }
  catch (e) {
    return false
  }
}

export type QueryResult = {
  id: string;
  metadata: {
    text: string,
  };
  score: number;
}

// calls our index with a query vector and returns the topK results
// can take more options such as namespace, filter, etc as seen here https://docs.pinecone.io/reference/query
export const query = async (vector: number[], topK: number): Promise<QueryResult[]> => {
  try {
    const result = await pineconeFetch({
      endpoint: "query",
      body: {
        includeValues: 'false',
        includeMetadata: true,
        topK,
        vector
      }
    })
    return result.matches
  }
  catch (e) {
    return []
  }
}