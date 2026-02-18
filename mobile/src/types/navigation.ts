/**
 * Root stack param list — navigator route params.
 */
export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Picker: { taskId?: string } | undefined;
  PickerHome: undefined;
  PickTaskList: undefined;
  PickTaskDetails: { taskId: string; scannedBarcode?: string; lineId?: string };
  Scanner: { returnToPick?: boolean; taskId?: string; lineId?: string };
  Hisob: undefined;
  Inventory: undefined;
  InventoryDetail: { productId: string };
};
