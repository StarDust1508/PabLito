import 'react-native-gesture-handler'; // ← самым первым импортом, до всего остального
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
