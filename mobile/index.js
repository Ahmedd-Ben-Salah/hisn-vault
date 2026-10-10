// ethers needs crypto.getRandomValues, which React Native does not have. Load the polyfill first.
import "react-native-get-random-values";
import "expo-router/entry";
