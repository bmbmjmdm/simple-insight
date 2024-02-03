import {MD3LightTheme as DefaultTheme, PaperProvider} from 'react-native-paper';
import React from 'react';
import {Provider as StoreProvider} from 'react-redux';
import Home from './Home';
import {store} from './store/store';

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    //primary: 'tomato',
    //secondary: 'yellow',
  },
};

const App = () => {
  return (
    <StoreProvider store={store}>
      <PaperProvider theme={theme}>
        <Home />
      </PaperProvider>
    </StoreProvider>
  );
};

export default App;
