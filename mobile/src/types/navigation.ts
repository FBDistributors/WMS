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
  Scanner: {
    returnToPick?: boolean;
    returnToReturns?: boolean;
    returnToKirimForm?: boolean;
    returnToMovement?: boolean;
    flow?: 'new' | 'return' | 'inventory';
    taskId?: string;
    lineId?: string;
    profileType?: 'picker' | 'controller';
    inventoryStep?: 1 | 2 | 3;
    inventoryLocationId?: string;
    inventoryLocationCode?: string;
  };
  Hisob: undefined;
  Inventory: undefined;
  InventoryDetail: { productId: string };
  QueueScreen: undefined;
  Returns: { scannedProductId?: string; scannedBarcode?: string } | undefined;
  Kirim: undefined;
  KirimForm:
    | {
        flow: 'new' | 'return' | 'inventory';
        scannedProductId?: string;
        scannedBarcode?: string;
        inventoryStep?: 1 | 2 | 3;
        inventoryLocationId?: string;
        inventoryLocationCode?: string;
      }
    | undefined;
  Movement: { scannedProductId?: string; scannedBarcode?: string } | undefined;
};
