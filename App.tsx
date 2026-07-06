import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChatScreen from '@/screens/ChatScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <ChatScreen />
    </SafeAreaProvider>
  );
}
