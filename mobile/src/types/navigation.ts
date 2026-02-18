/**
 * Root stack param list — navigator route params.
 */
export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Picker: { taskId?: string } | undefined;
  PickerHome: { profileType?: 'picker' | 'controller' } | undefined;
  PickTaskList: { profileType?: 'picker' | 'controller' } | undefined;
  PickTaskDetails: { taskId: string; scannedBarcode?: string; lineId?: string; profileType?: 'picker' | 'controller' };
  Scanner: { returnToPick?: boolean; taskId?: string; lineId?: string };
  Hisob: undefined;
  Inventory: undefined;
  InventoryDetail: { productId: string };
  QueueScreen: undefined;
};
