import {MD3LightTheme as DefaultTheme, PaperProvider} from 'react-native-paper';
import React from 'react';
import {Provider as StoreProvider} from 'react-redux';
import Home from './Home';
import {store} from './store/store';

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    inverseSurface: "white",
    surfaceVariant: "#f0f0f022",


    surfaceDisabled: "#ffdaed33",
    primary: "#ffdaedcc",
    outline: "#ffdaedcc",


    inverseOnSurface: "black",
    onSurface: "white",
    onSurfaceVariant: "white",
    onPrimary: "black",
    onSurfaceDisabled: "#00000033",



    primaryContainer: "red",
    secondaryContainer: "red",
    tirtiaryContainer: "red",
    background: "red",
    backdrop: "red",
    secondary: "red",
    tirtiary: "red",
    inversePrimary: "red",
    inverseSecondary: "red",
    inverseTirtiary: "red",
    onPrimaryContainer: "red",
    onSecondaryContainer: "red",
    onTirtiaryContainer: "red",
    onSecondary: "red",
    onTirtiary: "red",
    onBackground: "red",
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
