import {ScrollView, View, ImageBackground, Pressable} from 'react-native';
import {TextInput, Button, useTheme, Text, ActivityIndicator, Divider} from 'react-native-paper';
import React, {useEffect} from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { fetchAnswer, loadNotes, selectAnswer, selectHasNotes, selectIsLoading, selectFunfact, fetchFunfact, uploadNotes, selectIsUsingPrivateNotes, toggleUsePrivateNotes } from './store/notesSlice';
import background from './assets/background.jpg';
import AwesomeIcon from 'react-native-vector-icons/FontAwesome6';
import AsyncStorage from '@react-native-async-storage/async-storage';

const Home = () => {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const [question, setQuestion] = React.useState('');
  const hasNotes = useAppSelector(selectHasNotes)
  const isLoading = useAppSelector(selectIsLoading)
  const isUsingPrivateNotes = useAppSelector(selectIsUsingPrivateNotes)
  const answer = useAppSelector(selectAnswer)
  const [answerOpacity, setAnswerOpacity] = React.useState(0.1);
  const [funFactOpacity, setFunFactOpacity] = React.useState(0.1);
  const toggleAnswerOpacity = () => setAnswerOpacity(answerOpacity === 1 ? 0.1 : 1);
  const toggleFunFactOpacity = () => setFunFactOpacity(funFactOpacity === 1 ? 0.1 : 1);
  const funfact = useAppSelector(selectFunfact)

  const fileUpload = React.useRef(() => {
    dispatch(uploadNotes());
  }).current;

  const togglePrivateNotes = React.useRef(() => {
    dispatch(toggleUsePrivateNotes());
  }).current;

  const askAi = () => {
    const asyncFun = async () => {
      await dispatch(fetchAnswer(question));
      setAnswerOpacity(1);
    }
    asyncFun();
  };

  useEffect(() => {
    dispatch(loadNotes())
  }, []);

  // fetch a fun fact when possible
  useEffect(() => {
    const asyncFun = async () => {
      if (hasNotes) {
        await dispatch(fetchFunfact(false));
        setFunFactOpacity(1);
      }
    }
    asyncFun();
  }, [hasNotes]);

  return (
    <ImageBackground style={{flex: 1}} source={background} imageStyle={{resizeMode: 'cover'}}>
      <View style={{margin: 15, flex: 1}} >
        {isLoading ? <ActivityIndicator animating={true} size={400} style={{position: "absolute"}} /> : null}

        <View style={{flex: 1}}>
          <View style={{flexDirection: 'row'}}>
            <TextInput
              label="Question"
              multiline={false}
              value={question}
              onChangeText={text => setQuestion(text)}
              style={{flex: 20, borderTopRightRadius: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10}}
              theme={{colors: { primary: "#00000000" }}}
              underlineColor={theme.colors.surfaceVariant}
            />

            <Button
              style={{borderRadius: 0, justifyContent: 'center'}}
              mode="contained"
              onPress={askAi}
              disabled={!hasNotes || isLoading}
            >
              <AwesomeIcon name="bolt" size={20}/>
            </Button>

            <Button
              style={{borderRadius: 0, borderTopRightRadius: 10, borderBottomRightRadius: 10, justifyContent: 'center'}}
              mode="outlined"
              onPress={() => setQuestion('')}>
              <AwesomeIcon name="x" size={20}/>
            </Button>
          </View>

          <Space />

          <View style={{opacity: answerOpacity, flex: 1, backgroundColor: theme.colors.inverseSurface, borderRadius: 10, padding: 10}}>
            <ScrollView>
              <Text
                style={{color: theme.colors.inverseOnSurface}}
                variant="titleLarge"
                onPress={toggleAnswerOpacity}
              >
                {answer}
              </Text>
            </ScrollView>
            <Pressable style={{flex: 999}} onPress={toggleAnswerOpacity} />
          </View>
        </View>

        <Space />
        <Space />

        <View style={{flexDirection: 'row', flex: 1}}>

          <View style={{opacity: funFactOpacity, flex: 1, backgroundColor: theme.colors.inverseSurface, borderRadius: 10, padding: 10}}>
            <ScrollView>
              <Text
                variant="bodyLarge"
                style={{color: theme.colors.inverseOnSurface}}
                onPress={toggleFunFactOpacity}
              >
                {funfact}
              </Text>
            </ScrollView>
            <Pressable style={{flex: 999}} onPress={toggleFunFactOpacity} />
          </View>

          <Space />

          <View style={{flex: 1, justifyContent: "center"}}>
            <Button
              icon="file"
              mode="contained"
              onPress={fileUpload}
              disabled={isLoading}
            >
              Upload Notes
            </Button>

            {!hasNotes && (
              <Text variant="titleLarge" style={{color: theme.colors.error}}>
                No Notes
              </Text>
            )}
            
            <Space />

            <Button
              icon={isUsingPrivateNotes ? "exclamation" : "shield"}
              mode="contained"
              onPress={togglePrivateNotes}
              disabled={isLoading}
            >
              {isUsingPrivateNotes ? "Using Private" : "Not Using Private"}
            </Button>
            
            <Space />

            <Button
              icon="lightbulb"
              mode="contained"
              onPress={() => dispatch(fetchFunfact(true))}
              disabled={isLoading}
            >
              New Summary
            </Button>

          </View>
        </View>

      </View>
    </ImageBackground>
  );
};

const Space = () => {
  return <View style={{height: 30, width: 30}} />;
};

export default Home;
