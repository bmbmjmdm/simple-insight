export const SIMILAR_LINES_TO_QUESTION = 50;

export const SIMILAR_LINES_TO_TITLES = 2;

// 3,072 dimensions
// can switch to text-embedding-3-small for faster & cheaper but less accurate
export const EMBEDDING_MODEL = "text-embedding-3-large"; 

// can of course choose a stronger model if you like, but it costs more. gpt-4-turbo-preview, gpt-4-32k
export const CHAT_MODEL = "gpt-3.5-turbo-0125";

export const CHAT_MAX_TOKENS = 1000;
export const CHAT_TEMPERATURE = 1;
export const CHAT_FREQUENCY_PENALTY = 0; 