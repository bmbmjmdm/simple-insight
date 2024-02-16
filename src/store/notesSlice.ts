import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {RootState} from './store';
import EncryptedStorage from 'react-native-encrypted-storage';
import {pickFile, readFile} from '@dr.pogodin/react-native-fs';
import { QueryResult, chatCompletion, checkIndex, clearIndex, populateIndex, query } from './Network';
import uuid from 'react-native-uuid';
import { MindsetPrompt, RandomNote, TaskPrompt } from './Prompts';
import { SIMILAR_LINES_TO_QUESTION, SIMILAR_LINES_TO_TITLES } from './Parameters';
import AsyncStorage from '@react-native-async-storage/async-storage';



/******************************** TYPE DEFINITIONS  ********************************************/
// Here we define the structure of our state, notes, and other types






export interface NotesState {
  usePrivateNotes: boolean;
  databaseReady: boolean;
  noteMap: Record<string, SimpleNoteNote>;
  status: 'idle' | 'loading';
  answer: string;
  funfact: string;
}

const initialState: NotesState = {
  databaseReady: false,
  usePrivateNotes: true,
  noteMap: {},
  status: 'idle',
  answer: '',
  funfact: '',
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
    return await askAI(
      question,
      state.notes.databaseReady,
      state.notes.noteMap,
      !state.notes.usePrivateNotes
    );
  }
);

export const fetchFunfact = createAsyncThunk(
  'notes/fetchTask',
  async (forceFetch:boolean, {dispatch, getState}) => {
    // by default we don't want to fetch a new fun fact if we already have one that's less than 24 hours old
    if (!forceFetch) {
      const lastFunFactFetchedAt = await AsyncStorage.getItem('lastFunfactTime') || "0"
      const useOldFunFact = Date.now() - JSON.parse(lastFunFactFetchedAt) < 1000 * 60 * 60 * 24
      const oldFunFact = await AsyncStorage.getItem('funfact');
      if (useOldFunFact && oldFunFact) return oldFunFact; 
    }
    // otherwise, choose a random prompt and ask the AI to answer it using our notes
    const state:RootState = getState() as RootState
    const random = Math.random()
    console.log(random)
    const randomPrompt = random > 0.80 ? MindsetPrompt : random > 0.50 ? TaskPrompt : RandomNote;
    const newFunFact = await askAI(
      randomPrompt,
      state.notes.databaseReady,
      state.notes.noteMap,
      !state.notes.usePrivateNotes
    );
    // if we got a new fun fact, store it and the time we got it
    if (newFunFact) {
      await AsyncStorage.setItem('funfact', newFunFact);
      await AsyncStorage.setItem('lastFunfactTime', JSON.stringify(Date.now()));
    }
    return newFunFact;
  }
);

// helper function for all of our fetches to the AI
// this implements a RAG model to find notes similar to the user's question to include those when asking the ai
export const askAI = async (question:string, databaseReady:boolean, noteMap: Record<string,SimpleNoteNote>, filterPrivate: boolean):Promise<string> => {
  if (!databaseReady) return 'No database';
  // special case where we want to ask the AI about a specific random note
  if (question === RandomNote) {
    const noteKeys = Object.keys(noteMap);
    const getRandomNote = () => {
      return noteMap[noteKeys[Math.floor(Math.random() * noteKeys.length)]]
    }
    let randomNote: SimpleNoteNote = getRandomNote();
    // we dont want old notes for this
    while (randomNote?.tags?.includes("old")) {
      randomNote = getRandomNote();
    }
    const aiResponse = await chatCompletion(question, randomNote.content)
    return `${aiResponse}\n\nOriginal Note:\n\n${randomNote.content}`;
  }

  // find X lines similar to our question
  const similarLines:QueryResult[] = await query(question, SIMILAR_LINES_TO_QUESTION);
  // map those lines to notes
  let similarNotes:Set<string> = new Set();
  for (const line of similarLines) {
    const fullNote = noteMap[line.metadata.noteId]
    if (filterPrivate) {
      if (fullNote.tags?.includes("private")) continue;
    }
    similarNotes.add(fullNote.content);
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
          const fullNote = noteMap[line.metadata.noteId]
          if (filterPrivate) {
            if (fullNote.tags?.includes("private")) continue;
          }
          similarNotes.add(fullNote.content);
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
const parseNotes = (rawJson: string): {lines: NoteLine[], map: Record<string,SimpleNoteNote>} => {
  const jsonParsed: SimpleNoteExport = JSON.parse(rawJson);
  for (const note of jsonParsed.trashedNotes) {
    note.tags = note.tags || [];
    note.tags.push('old');
  }
  // we now have a list of all notes in their proper SimpleNoteNote form
  const allNoteObjects = [
    ...jsonParsed.activeNotes,
    ...jsonParsed.trashedNotes,
  ];
  const allNoteStrings: NoteLine[] = [];
  const allNoteMaps: Record<string, SimpleNoteNote> = {};
  // go through every note
  for (const note of allNoteObjects) {
    const noteContent = note.content.trim();
    // store the full note in our map based on id
    if (noteContent) allNoteMaps[note.id] = note;
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
  reducers: {
    toggleUsePrivateNotes: state => {
      state.usePrivateNotes = !state.usePrivateNotes;
    }
  },
  extraReducers: builder => {
    builder
    // fetch answer
      .addCase(fetchAnswer.pending, state => {
        console.log("fetchAnswer pending")
        state.status = 'loading';
      })
      .addCase(fetchAnswer.fulfilled, (state, action) => {
        console.log("fetchAnswer fulfilled")
        state.status = 'idle';
        state.answer = action.payload;
      })
      .addCase(fetchAnswer.rejected, (state, action) => {
        console.log("fetchAnswer rejected")
        state.status = 'idle';
        state.answer = "Error: " + action.error.message;
      })
    // fetch funfact
      .addCase(fetchFunfact.pending, state => {
        console.log("fetchFunfact pending")
        state.status = 'loading';
      })
      .addCase(fetchFunfact.fulfilled, (state, action) => {
        console.log("fetchFunfact fulfilled")
        state.status = 'idle';
        state.funfact = action.payload;
      })
      .addCase(fetchFunfact.rejected, (state, action) => {
        console.log("fetchFunfact rejected")
        state.status = 'idle';
        state.funfact = "Error: " + action.error.message;
      })
    // upload notes
      .addCase(uploadNotes.pending, state => {
        console.log("uploadNotes pending")
        state.status = 'loading';
      })
      .addCase(uploadNotes.fulfilled, (state, action) => {
        console.log("uploadNotes fulfilled")
        state.status = 'idle';
        state.databaseReady = !!action.payload?.databaseReady;
        state.noteMap = action.payload?.noteMap || {};
        if (!state.databaseReady) state.answer = "Error: Notes failed to upload, please check your internet connection and json file, or restart the app.";
      })
      .addCase(uploadNotes.rejected, (state, action) => {
        console.log("uploadNotes rejected")
        state.status = 'idle';
        state.answer = "Error Loading Notes: " + action.error.message;
      })
    // load notes
      .addCase(loadNotes.pending, state => {
        console.log("loadNotes pending")
        state.status = 'loading';
      })
      .addCase(loadNotes.fulfilled, (state, action) => {
        console.log("loadNotes fulfilled")
        state.status = 'idle';
        state.databaseReady = !!action.payload?.databaseReady;
        state.noteMap = action.payload?.noteMap || {};
        if (!state.databaseReady) state.answer = "Error: Notes failed to upload, please check your internet connection and json file, or restart the app";
      })
      .addCase(loadNotes.rejected, (state, action) => {
        console.log("loadNotes rejected")
        state.status = 'idle';
        state.answer = "Error Loading Notes: " + action.error.message;
      })
  },
});

// We export our "normal" reducers via actions generated by the slice
export const { toggleUsePrivateNotes } = notesSlice.actions;

// We export parts of our state via selectors
export const selectHasNotes = (state: RootState) => state.notes.databaseReady;
export const selectAnswer = (state: RootState) => state.notes.answer;
export const selectFunfact = (state: RootState) => state.notes.funfact;
export const selectIsLoading = (state: RootState) => state.notes.status === 'loading';
export const selectIsUsingPrivateNotes = (state: RootState) => state.notes.usePrivateNotes;

// this allows us to add the notes slice to our store
export default notesSlice.reducer;
