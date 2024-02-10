import { OpenAIKey, PineconeKey, PineconeServer } from '../secrets'
import { CHAT_FREQUENCY_PENALTY, CHAT_MAX_TOKENS, CHAT_MODEL, CHAT_TEMPERATURE, EMBEDDING_MODEL } from './Parameters';
import { NotesPrompt, ChatPrompt } from './Prompts';
import { NoteLine } from './notesSlice';
import uuid from 'react-native-uuid';


export const chatCompletion = async (question: string, notes: string): Promise<string> => {
  try {
    console.log(notes.length);
    const result = await fetch(`https://api.openai.com/v1/chat/completions`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Bearer ${OpenAIKey}`
      },
      body: JSON.stringify({
        model: CHAT_MODEL, 
        messages: [
          { role: 'system', content: ChatPrompt },
          { role: 'system', content: NotesPrompt(notes) },
          { role: 'user', content: question }
        ],
        max_tokens: CHAT_MAX_TOKENS,
        temperature: CHAT_TEMPERATURE,
        frequency_penalty: CHAT_FREQUENCY_PENALTY
      })
    })
    if (result.status !== 200) throw new Error(`Status ${result.status}`)
    const json = await result.json()
    return json.choices[0].message.content
  }
  catch (e) {
    console.log(`Chat failed`)
    console.log(e)
    return `Chat failed: ${e}`
  }
}

type PineconeFetch = {
  endpoint: string;
  body?: Object;
  secondTry?: boolean; 
}

// helper function that makes a fetch call to our pinecone server, returns the json response or null if it fails
// has a built-in retry
// https://docs.pinecone.io/reference/upsert
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
  id: string;
  metadata: {
    text: string,
    noteId: string,
  };
  values: number[];
}



// Batch an array of note lines and embed + upsert each batch
export const populateIndex = async (
  lines: NoteLine[]
) => {
  const batches = sliceIntoChunks<NoteLine>(lines, 10);
  for (const batch of batches) {
    const embeddings = await Promise.all(
      batch.map((line) => embed(line))
    );
    const passed = await upsertVectors(embeddings);
    if (!passed) return false
  }
  return true
}

// calls our index and deletes all vectors, returns true if successful
export const upsertVectors = async (vectors: Vector[]): Promise<boolean> => {
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
    noteId: string,
  };
  score: number;
}

// calls our index with a query vector and returns the topK results
// can take more options such as namespace, filter, etc as seen here https://docs.pinecone.io/reference/query
export const query = async (queryString: string, topK: number): Promise<QueryResult[]> => {
  const vector:number[] = (await embed({
    text: queryString,
    noteId: uuid.v4() as string,
    lineId: uuid.v4() as string,
  })).values
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


// Embed a single string
const embed = async (line: NoteLine, secondTry = false): Promise<Vector> => {
  try {
    const result = await fetch(`https://api.openai.com/v1/embeddings`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: `Bearer ${OpenAIKey}`
      },
      body: JSON.stringify({
        input: line.text,
        model: EMBEDDING_MODEL,
      })
    })
    if (result.status !== 200) throw new Error(`Embedding failed with status: ${result.status}`)
    const json = await result.json()
    return {
      metadata: {
        text: line.text,
        noteId: line.noteId
      },
      values: json.data[0].embedding,
      id: line.lineId
    };
  }
  catch (e) {
    console.log(`Embedding failed`)
    console.log(e)
    if (secondTry) throw e
    else return await embed(line, true)
  }
}

// breaks up an array into an array of arrays, where each subarray has at most chunkSize elements
const sliceIntoChunks = <T>(arr: T[], chunkSize: number) => {
  return Array.from({ length: Math.ceil(arr.length / chunkSize) }, (_, i) =>
    arr.slice(i * chunkSize, (i + 1) * chunkSize)
  );
};