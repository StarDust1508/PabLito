import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChatScreen from '@/screens/ChatScreen';
import { ThemeProvider } from '@/theme/ThemeProvider';

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces: require('./assets/fonts/Fraunces.ttf'),
    SpaceGrotesk: require('./assets/fonts/SpaceGrotesk.ttf'),
    SpaceMono: require('./assets/fonts/SpaceMono-Regular.ttf'),
    'SpaceMono-Bold': require('./assets/fonts/SpaceMono-Bold.ttf'),
  });

  // Держим splash-цвет, пока шрифты грузятся. Если шрифт не распарсился (fontError) —
  // всё равно запускаемся на системном шрифте, чтобы не залипнуть на пустом экране.
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ChatScreen />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
