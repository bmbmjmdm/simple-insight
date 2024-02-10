import {ScrollView, View} from 'react-native';
import {TextInput, Button, useTheme, Text, ActivityIndicator, Divider} from 'react-native-paper';
import React, {useEffect} from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { fetchAnswer, fetchMindset, fetchTask, loadNotes, selectAnswer, selectHasNotes, selectIsLoading, selectMindset, selectTask, uploadNotes } from './store/notesSlice';

const Home = () => {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const [question, setQuestion] = React.useState('');
  const hasNotes = useAppSelector(selectHasNotes)
  const isLoading = useAppSelector(selectIsLoading)
  const answer = useAppSelector(selectAnswer)
  const mindset = useAppSelector(selectMindset)
  const task = useAppSelector(selectTask)
  const flatTop = React.useRef({
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  }).current;

  const fileUpload = React.useRef(() => {
    dispatch(uploadNotes());
  }).current;

  const askAi = () => {
    dispatch(fetchAnswer(question));
  };

  useEffect(() => {
    dispatch(loadNotes())
  }, []);

  useEffect(() => {
    if (hasNotes) {
      // TODO add a button to fetch these so it doesnt fetch every single time the app is opened, couldbe costly
      //dispatch(fetchMindset());
      //dispatch(fetchTask());
    }
  }, [hasNotes]);

  return (
    <View style={{margin: 15, flex: 1}}>
      {isLoading ? <ActivityIndicator animating={true} style={{position: "absolute", right: 0, top: 0}} /> : null}
      {isLoading ? <ActivityIndicator animating={true} style={{position: "absolute", right: 0, bottom: 0}} /> : null}

      <View style={{height: 100, marginBottom: 10}}>
        <ScrollView>
          <Text
            variant="bodyLarge"
            style={{color: theme.colors.inverseOnSurface}}
          >
            {mindset}
          </Text>
        </ScrollView>
      </View>
      <Divider />
      <View style={{height: 100, marginTop: 10}}>
        <ScrollView>
          <Text
            variant="bodyLarge"
            style={{color: theme.colors.inverseOnSurface}}
          >
            {task}
          </Text>
        </ScrollView>
      </View>

      <Button
        icon="file"
        style={{borderRadius: 5, width: 200}}
        textColor={theme.colors.inversePrimary}
        mode="outlined"
        onPress={fileUpload}
        disabled={isLoading}
      >
        Upload Notes
      </Button>

      {!hasNotes && (
        <Text variant="labelLarge" style={{color: theme.colors.error}}>
          No Notes
        </Text>
      )}

      <VerticalSpace />

      <TextInput
        label="Question"
        multiline={true}
        numberOfLines={4}
        value={question}
        onChangeText={text => setQuestion(text)}
      />

      <View style={{flexDirection: 'row'}}>
        <Button
          style={{...flatTop, flex: 4}}
          mode="contained"
          onPress={askAi}
          disabled={!hasNotes || isLoading}
        >
          Ask
        </Button>

        <Button
          style={{...flatTop, flex: 1, marginLeft: 15}}
          textColor={theme.colors.inversePrimary}
          mode="outlined"
          onPress={() => setQuestion('')}>
          Clear
        </Button>
      </View>

      <VerticalSpace />

      <ScrollView style={{flex: 1}}>
        <Text
          variant="titleLarge"
          style={{color: theme.colors.inverseOnSurface}}
        >
          {answer}
        </Text>
      </ScrollView>
    </View>
  );
};

const VerticalSpace = ({small}: {small?: boolean}) => {
  return <View style={{height: small ? 25 : 50}} />;
};

export default Home;
