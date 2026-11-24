// Android / iOS: persistent storage for the login session, provided by expo-sqlite
import 'expo-sqlite/localStorage/install';

export const sessionStorage: Storage | undefined = localStorage;
