/// <reference types="expo/types" />
import 'react-native';

declare module 'react-native' {
  interface ViewProps {
    key?: React.Key | null | undefined;
  }
}

declare module 'expo-splash-screen' {
  export function preventAutoHideAsync(): Promise<boolean>;
  export function hideAsync(): Promise<boolean>;
  export function setOptions(options: { duration?: number; fade?: boolean }): Promise<boolean>;
}
