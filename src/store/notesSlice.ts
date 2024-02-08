import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {RootState} from './store';
import EncryptedStorage from 'react-native-encrypted-storage';
import {pickFile, readFile} from '@dr.pogodin/react-native-fs';
import { FeatureExtractionPipeline, pipeline } from '@xenova/transformers';
import { QueryResult, Vector, checkIndex, clearIndex, populateIndex, query } from './Network';




/******************************** TYPE DEFINITIONS  ********************************************/
// Here we define the structure of our state, notes, and other types






export interface NotesState {
  databaseReady: boolean;
  status: 'idle' | 'loading';
  answer: string;
  mindset: string;
  task: string;
}

const initialState: NotesState = {
  databaseReady: false,
  status: 'idle',
  answer: '',
  mindset: '',
  task: '',
};

type SimpleNoteExport = {
  activeNotes: SimpleNoteNote[];
  trashedNotes: SimpleNoteNote[];
};

type SimpleNoteNote = {
  id: string;
  content: string;
  creationDate: string;
  lastModified: string;
  tags?: string[];
};






/******************************** FUNCTION DEFINITIONS  ********************************************/
// Here we have most of the functionality of our slice, via async thunk actions






export const fetchAnswer = createAsyncThunk(
  'notes/fetchAnswer',
  async (question: string, {dispatch, getState}) => {
    const state:RootState = getState() as RootState
    return await askAI(question, state.notes.databaseReady);
  }
);

export const fetchMindset = createAsyncThunk(
  'notes/fetchMindset',
  async ({}, {dispatch, getState}) => {
    const state:RootState = getState() as RootState
    return await askAI("Self_Reflection - What mindset can I take on to help myself improve today? What should I remember; how should I act?", state.notes.databaseReady);
  }
);

export const fetchTask = createAsyncThunk(
  'notes/fetchTask',
  async ({}, {dispatch, getState}) => {
    const state:RootState = getState() as RootState
    return await askAI("Projects - What task should I try to take on today? What's something small I can try to find time for that can help build towards a bigger project, improve my life, or improve the world?", state.notes.databaseReady);
  }
);

// TODO hook up to actual LLM
// helper function for all of our fetches to the AI
export const askAI = async (question:string, databaseReady:boolean):Promise<string> => {
  if (!databaseReady || !pipe) return 'No database';
  const similarNotes:QueryResult[] = await query(
    (await embed(question)).values,
    50,
  );
  return similarNotes.map(note => note.metadata?.text).join('\n');
  // TODO pass these queried notes to LLM and ask it the question
}

export const uploadNotes = createAsyncThunk(
  'notes/uploadNotes',
  async ({}, {dispatch, getState}) => {
    // prompt the user to select their SimpleNote export file and read it
    const fileUriArray = await pickFile({mimeTypes: ['application/json']});
    if (fileUriArray.length === 0) return;
    const fileContent = await readFile(fileUriArray[0]);
    // parse export file into a list of strings
    const notes = parseNotes(fileContent);
    // store notes for later so the user doesn't have to reupload
    await EncryptedStorage.setItem(
      'simple-insight-user-notes',
      JSON.stringify(notes),
    );
    // parse notes into a RAG db
    return await setupRAG(notes, true);
  },
)

export const loadNotes = createAsyncThunk(
  'notes/loadNotes',
  async ({}, {dispatch, getState}) => {
    // load the user's notes from storage
    const fileContent = await EncryptedStorage.getItem(
      'simple-insight-user-notes',
    );
    // if they exist, set them up in a RAG db
    if (fileContent) {
      const notes = JSON.parse(fileContent);
      return await setupRAG(notes, false);
    }
  }
)

// helper function to parse the notes from the json
const parseNotes = (rawJson: string): string[] => {
  const jsonParsed: SimpleNoteExport = JSON.parse(rawJson);
  // we now have a list of all notes in their proper SimpleNoteNote form
  const allNoteObjects = [
    ...jsonParsed.activeNotes,
    ...jsonParsed.trashedNotes,
  ];
  const allNoteStrings: string[] = [];
  // go through every note
  for (const note of allNoteObjects) {
    // split it into lines. if there are no lines, skip this note
    const lines = note.content.split('\n\n');
    if (lines.length === 0) continue;
    const firstLine = lines[0].trim();
    const restLines = lines.slice(1);
    const tags = note.tags ? note.tags.join(' ') : '';
    // for each line, add it to the final list as its own note, adding the tags and first line (title) to the beginning
    for (const line of restLines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) continue;
      allNoteStrings.push(`${tags} - ${firstLine} - ${trimmedLine}`);
    }
  }
  return allNoteStrings;
};


// https://github.com/pinecone-io/semantic-search-example
// looks like i can connect to the hosted index here https://app.pinecone.io/organizations/-NSV2H13QbABOEJNJ6-o/projects/us-west1-gcp:3c78ac3/indexes/test/browser
// using this api and its "host" location https://docs.pinecone.io/reference/upsert
// going to need to:
// create index if it doesnt exist
// if we're uploading new notes, we need to delete all entries and reupload 
// if we're just loading, then we need to verify that that index is properly populated
// then we can query it

let pipe:FeatureExtractionPipeline;

type TextMetadata = {
  text: string
}

// TODO langchain/hugging face isnt actually supported by React Native yet :/
// replace with pinecone or openai or something else
// helper function to setup RAG from a list of notes
const setupRAG = async (notes:string[], newNotes: boolean):Promise<boolean> => {
  // setup pipeline for embeddings
  if (!pipe) pipe = await pipeline('embeddings', 'Xenova/all-MiniLM-L6-v2');
  let ready = false
  // if we're not uploading new notes, check to see if our existing index is good 
  if (!newNotes) ready = await checkIndex();
  if (ready) return true;
  // if we're uploading new notes or our index is bad, clear it and reupload
  await clearIndex();
  return await createAndUpsertVectors(notes);
};

// Embed a single string
const embed = async (text: string): Promise<Vector> => {
  const result = pipe && (await pipe(text));
  return {
    metadata: {
      text,
    },
    values: Array.from(result.data),
  };
}

// Batch an array of strings and embed + upsert each batch
const createAndUpsertVectors = async (
  texts: string[]
) => {
  const batches = sliceIntoChunks<string>(texts, 10);
  for (const batch of batches) {
    const embeddings = await Promise.all(
      batch.map((text) => embed(text))
    );
    const failed = await populateIndex(embeddings);
    if (!failed) return false
  }
  return true
}

// breaks up an array into an array of arrays, where each subarray has at most chunkSize elements
const sliceIntoChunks = <T>(arr: T[], chunkSize: number) => {
  return Array.from({ length: Math.ceil(arr.length / chunkSize) }, (_, i) =>
    arr.slice(i * chunkSize, (i + 1) * chunkSize)
  );
};






/******************************** SLICE SETUP  ********************************************/
// This allows us to use all the above functions/state via the redux store






// We create a slice for our notes, which contains our initial state and reducers
// The `reducers` field lets us define reducers and generate associated actions
// The `extraReducers` field lets the slice handle actions defined elsewhere,
// including actions generated by createAsyncThunk or in other slices.
export const notesSlice = createSlice({
  name: 'notes',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
    // fetch answer
      .addCase(fetchAnswer.pending, state => {
        state.status = 'loading';
      })
      .addCase(fetchAnswer.fulfilled, (state, action) => {
        state.status = 'idle';
        state.answer = action.payload;
      })
      .addCase(fetchAnswer.rejected, (state, action) => {
        state.status = 'idle';
        state.answer = "Error: " + action.error.message;
      })
    // fetch mindset
      .addCase(fetchMindset.pending, state => {
        state.status = 'loading';
      })
      .addCase(fetchMindset.fulfilled, (state, action) => {
        state.status = 'idle';
        state.mindset = action.payload;
      })
      .addCase(fetchMindset.rejected, (state, action) => {
        state.status = 'idle';
        state.mindset = "Error: " + action.error.message;
      })
    // fetch task
      .addCase(fetchTask.pending, state => {
        state.status = 'loading';
      })
      .addCase(fetchTask.fulfilled, (state, action) => {
        state.status = 'idle';
        state.task = action.payload;
      })
      .addCase(fetchTask.rejected, (state, action) => {
        state.status = 'idle';
        state.task = "Error: " + action.error.message;
      })
    // upload notes
      .addCase(uploadNotes.pending, state => {
        state.status = 'loading';
      })
      .addCase(uploadNotes.fulfilled, (state, action) => {
        state.status = 'idle';
        state.databaseReady = !!action.payload;
        if (!state.databaseReady) state.answer = "Error: Notes failed to upload, please check your internet connection and json file, or restart the app.";
      })
      .addCase(uploadNotes.rejected, (state, action) => {
        state.status = 'idle';
        state.answer = "Error Loading Notes: " + action.error.message;
      })
    // load notes
      .addCase(loadNotes.pending, state => {
        state.status = 'loading';
      })
      .addCase(loadNotes.fulfilled, (state, action) => {
        state.status = 'idle';
        state.databaseReady = !!action.payload;
        if (!state.databaseReady) state.answer = "Error: Notes failed to upload, please check your internet connection and json file, or restart the app";
      })
      .addCase(loadNotes.rejected, (state, action) => {
        state.status = 'idle';
        state.answer = "Error Loading Notes: " + action.error.message;
      })
  },
});

// We export our "normal" reducers via actions generated by the slice
export const {} = notesSlice.actions;

// We export parts of our state via selectors
export const selectHasNotes = (state: RootState) => state.notes.ragDB !== undefined;
export const selectAnswer = (state: RootState) => state.notes.answer;
export const selectMindset = (state: RootState) => state.notes.mindset;
export const selectTask = (state: RootState) => state.notes.task;
export const selectIsLoading = (state: RootState) => state.notes.status === 'loading';

// this allows us to add the notes slice to our store
export default notesSlice.reducer;
