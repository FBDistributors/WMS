/**
 * Root stack param list — navigator route params.
 */
export type RootStackParamList = {
  Home: undefined;
  Picker: { taskId?: string } | undefined;
  Scanner: undefined;
};
