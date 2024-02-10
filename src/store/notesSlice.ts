import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {RootState} from './store';
import EncryptedStorage from 'react-native-encrypted-storage';
import {pickFile, readFile} from '@dr.pogodin/react-native-fs';
import { QueryResult, chatCompletion, checkIndex, clearIndex, populateIndex, query } from './Network';
import uuid from 'react-native-uuid';
import { MindsetPrompt, TaskPrompt } from './Prompts';
import { SIMILAR_LINES_TO_QUESTION, SIMILAR_LINES_TO_TITLES } from './Parameters';



/******************************** TYPE DEFINITIONS  ********************************************/
// Here we define the structure of our state, notes, and other types






export interface NotesState {
  databaseReady: boolean;
  noteMap: Record<string, string>;
  status: 'idle' | 'loading';
  answer: string;
  mindset: string;
  task: string;
}

const initialState: NotesState = {
  databaseReady: false,
  noteMap: {},
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

export type NoteLine = {
  text: string;
  noteId: string;
  lineId: string;
}






/******************************** FUNCTION DEFINITIONS  ********************************************/
// Here we have most of the functionality of our slice, via async thunk actions






export const fetchAnswer = createAsyncThunk(
  'notes/fetchAnswer',
  async (question: string, {dispatch, getState}) => {
    const state:RootState = getState() as RootState
    return await askAI(question, state.notes.databaseReady, state.notes.noteMap);
  }
);

export const fetchMindset = createAsyncThunk(
  'notes/fetchMindset',
  async (props, {dispatch, getState}) => {
    const state:RootState = getState() as RootState
    return await askAI(
      MindsetPrompt,
      state.notes.databaseReady,
      state.notes.noteMap
    );
  }
);

export const fetchTask = createAsyncThunk(
  'notes/fetchTask',
  async (props, {dispatch, getState}) => {
    const state:RootState = getState() as RootState
    return await askAI(
      TaskPrompt,
      state.notes.databaseReady,
      state.notes.noteMap
    );
  }
);

// helper function for all of our fetches to the AI
// this implements a RAG model to find notes similar to the user's question to include those when asking the ai
export const askAI = async (question:string, databaseReady:boolean, noteMap: Record<string,string>):Promise<string> => {
  if (!databaseReady) return 'No database';
  // find X lines similar to our question
  const similarLines:QueryResult[] = await query(question, SIMILAR_LINES_TO_QUESTION);
  // map those lines to notes
  let similarNotes:Set<string> = new Set();
  for (const line of similarLines) {
    similarNotes.add(noteMap[line.metadata.noteId]);
  }

  // for each unique note, query Y similar lines based on its title
  if (SIMILAR_LINES_TO_TITLES > 0) {
    const similarSimilarNotesPromises = [];
    for (const note of similarNotes) {
      // make these calls concurrently by calling them in promise functions
      const asyncFun = async () => {
        const title = note.split('\n')[0].trim();
        // +1 because the 1st result is going to be the title itself
        const newLines:QueryResult[] = await query(title, SIMILAR_LINES_TO_TITLES + 1);
        // map those lines to notes and add to our set
        for (const line of newLines) {
          similarNotes.add(noteMap[line.metadata.noteId]);
        }
      }
      similarSimilarNotesPromises.push(asyncFun());
    }
    await Promise.all(similarSimilarNotesPromises);
  }

  // combine all the notes into a single string to be added to our prompt
  const notesBlob = Array.from(similarNotes).join('\n\n');

  return await chatCompletion(question, notesBlob)
}

export const uploadNotes = createAsyncThunk(
  'notes/uploadNotes',
  async (props, {dispatch, getState}) => {
    // prompt the user to select their SimpleNote export file and read it
    const fileUriArray = await pickFile({mimeTypes: ['application/json']});
    if (fileUriArray.length === 0) throw new Error("No file selected");
    const fileContent = await readFile(fileUriArray[0]);
    // parse export file into a list of strings
    const notes = parseNotes(fileContent);
    // store notes for later so the user doesn't have to reupload
    await EncryptedStorage.setItem(
      'simple-insight-user-notes',
      JSON.stringify(notes),
    );
    // parse notes into a RAG db
    const databaseReady = await setupRAG(notes.lines, true);
    return {
      databaseReady,
      noteMap: notes.map,
    }
  }
)

export const loadNotes = createAsyncThunk(
  'notes/loadNotes',
  async (props, {dispatch, getState}) => {
    // load the user's notes from storage
    const fileContent = await EncryptedStorage.getItem(
      'simple-insight-user-notes',
    );
    // if they exist, set them up in a RAG db
    if (fileContent) {
      const notes = JSON.parse(fileContent);
      // parse notes into a RAG db
      const databaseReady = await setupRAG(notes.lines, false);
      return {
        databaseReady,
        noteMap: notes.map,
      }
    }
    else {
      return {
        databaseReady: false,
        noteMap: {},
      }
    }
  }
)

// helper function to parse the notes from the json
// we want to parse the note into a map of id => note
// and a list of all lines in all notes
const parseNotes = (rawJson: string): {lines: NoteLine[], map: Record<string,string>} => {
  const jsonParsed: SimpleNoteExport = JSON.parse(rawJson);
  // we now have a list of all notes in their proper SimpleNoteNote form
  const allNoteObjects = [
    ...jsonParsed.activeNotes,
    ...jsonParsed.trashedNotes,
  ];
  const allNoteStrings: NoteLine[] = [];
  const allNoteMaps: Record<string, string> = {};
  // go through every note
  for (const note of allNoteObjects) {
    const noteContent = note.content.trim();
    // store the full note in our map based on id
    allNoteMaps[note.id] = noteContent;
    // split it into lines and extract the title & tags
    const lines = noteContent.split('\n\n'); // TODO is this a good split point?
    let firstLine = lines[0].trim();
    let restLines = lines.slice(1);
    const tags = note.tags ? note.tags.join(' ') : '';
    // if we only have 1 line in the file, it may be that its using single newlines instead of double. try again with single newline splitting
    if (restLines.length === 0) {
      const thinnerLines = firstLine.split('\n');
      firstLine = thinnerLines[0].trim();
      restLines = thinnerLines.slice(1);
    }
    // now we need to check if the title is the only line in the file, and if so, we need to move it to the rest lines
    if (restLines.length === 0 && firstLine.length > 0) {
      restLines.push(firstLine);
      firstLine = '';
    }
    // for each line, add it to the final list as its own note, adding the tags and first line (title) to the beginning
    for (const line of restLines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) continue;
      allNoteStrings.push({
        text: `${tags} - ${firstLine} - ${trimmedLine}`,
        noteId: note.id,
        lineId: uuid.v4() as string,
      });
    }
  }
  return {lines: allNoteStrings, map: allNoteMaps};
};


// TODO langchain/hugging face isnt actually supported by React Native yet :/
// replace with pinecone or openai or something else
// helper function to setup RAG from a list of notes
const setupRAG = async (notes:NoteLine[], newNotes: boolean):Promise<boolean> => {
  let ready = false
  // if we're not uploading new notes, check to see if our existing index is good 
  console.log("check index")
  if (!newNotes) ready = await checkIndex();
  if (ready) return true;
  console.log("index not ready")
  console.log("clearing index")
  // if we're uploading new notes or our index is bad, clear it and reupload
  await clearIndex();
  console.log("index cleared")
  console.log("populating index")
  return await populateIndex(notes);
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
        state.databaseReady = !!action.payload?.databaseReady;
        state.noteMap = action.payload?.noteMap || {};
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
        state.databaseReady = !!action.payload?.databaseReady;
        state.noteMap = action.payload?.noteMap || {};
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
export const selectHasNotes = (state: RootState) => state.notes.databaseReady;
export const selectAnswer = (state: RootState) => state.notes.answer;
export const selectMindset = (state: RootState) => state.notes.mindset;
export const selectTask = (state: RootState) => state.notes.task;
export const selectIsLoading = (state: RootState) => state.notes.status === 'loading';

// this allows us to add the notes slice to our store
export default notesSlice.reducer;
