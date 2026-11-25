import type { ExpoConfig } from 'expo/config';

/**
 * App configuration. SharePoint / Entra values are NOT stored here: they come from
 * EXPO_PUBLIC_* environment variables (see .env.example) and are read by src/config/env.ts.
 */
const SCHEME = 'potracker';
const BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'com.jrsllc.potracker';

const config: ExpoConfig = {
  name: 'PO Tracker',
  slug: 'po-tracker',
  version: '1.0.0',
  scheme: SCHEME,
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
    infoPlist: {
      NSCameraUsageDescription: 'Take photos of PO documents to upload to SharePoint.',
      NSPhotoLibraryUsageDescription: 'Choose photos of PO documents to upload to SharePoint.',
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
    output: 'single',
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-web-browser',
    'expo-secure-store',
    'expo-sqlite',
    'expo-background-task',
    'expo-sharing',
    [
      'expo-image-picker',
      {
        photosPermission: 'Choose photos of PO documents to upload to SharePoint.',
        cameraPermission: 'Take photos of PO documents to upload to SharePoint.',
      },
    ],
    ['expo-notifications', { color: '#1F6FEB' }],
    '@react-native-community/datetimepicker',
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
