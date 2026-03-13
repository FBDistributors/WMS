/**
 * Root stack param list — navigator route params.
 */
export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Picker: { taskId?: string } | undefined;
  PickerHome: { profileType?: 'picker' | 'controller' } | undefined;
  PickTaskList: {
    profileType?: 'picker' | 'controller';
    completedMessage?: string;
    scannedBarcode?: string;
    openConsolidated?: boolean;
    selectedProductKey?: string;
  } | undefined;
  ConsolidatedPick: undefined;
  PickTaskDetails: { taskId: string; scannedBarcode?: string; lineId?: string; profileType?: 'picker' | 'controller' };
  Scanner: {
    returnToPick?: boolean;
    returnToConsolidated?: boolean;
    returnToReturns?: boolean;
    returnToKirimForm?: boolean;
    returnToMovement?: boolean;
    flow?: 'new' | 'return' | 'inventory';
    warehouse?: 'main' | 'showroom';
    taskId?: string;
    lineId?: string;
    profileType?: 'picker' | 'controller';
    selectedProductKey?: string;
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
  KirimNew: undefined;
  KirimForm:
    | {
        flow: 'new' | 'return' | 'inventory';
        warehouse?: 'main' | 'showroom';
        scannedProductId?: string;
        scannedBarcode?: string;
        inventoryStep?: 0 | 1 | 2 | 3;
        inventorySubMode?: 'byLocation' | 'byScan';
        inventoryLocationId?: string;
        inventoryLocationCode?: string;
      }
    | undefined;
  Movement: { scannedProductId?: string; scannedBarcode?: string } | undefined;
};
