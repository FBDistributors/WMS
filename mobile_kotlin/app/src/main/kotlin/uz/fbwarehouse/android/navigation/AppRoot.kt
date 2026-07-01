package uz.fbwarehouse.android.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import uz.fbwarehouse.android.auth.presentation.AuthViewModel
import uz.fbwarehouse.android.auth.presentation.ChangePasswordScreen
import uz.fbwarehouse.android.auth.presentation.HomeScreen
import uz.fbwarehouse.android.auth.presentation.LoginScreen
import uz.fbwarehouse.android.auth.presentation.SessionState
import uz.fbwarehouse.android.core.network.MeResponse
import uz.fbwarehouse.android.customerreturns.presentation.CustomerReturnDetailScreen
import uz.fbwarehouse.android.customerreturns.presentation.CustomerReturnQueueScreen
import uz.fbwarehouse.android.feedback.presentation.FeedbackScreen
import uz.fbwarehouse.android.inventory.presentation.InventorySearchScreen
import uz.fbwarehouse.android.movement.presentation.MovementScreen
import uz.fbwarehouse.android.picking.presentation.PickTaskDetailScreen
import uz.fbwarehouse.android.picking.presentation.PickTaskListScreen
import uz.fbwarehouse.android.receiving.presentation.NewReceiptScreen
import uz.fbwarehouse.android.scanner.presentation.ScannerScreen

private object Routes {
    const val HOME = "home"
    const val PICK_TASKS = "pick_tasks"
    const val PICK_TASK_DETAIL = "pick_task_detail/{documentId}"
    const val INVENTORY = "inventory"
    const val RECEIVING = "receiving"
    const val CUSTOMER_RETURNS = "customer_returns"
    const val CUSTOMER_RETURN_DETAIL = "customer_return_detail/{returnId}"
    const val ACCOUNT = "account"
    const val FEEDBACK = "feedback/{role}"
    const val SCANNER = "scanner"
    const val MOVEMENT = "movement"
    fun pickTaskDetail(documentId: String) = "pick_task_detail/$documentId"
    fun customerReturnDetail(returnId: String) = "customer_return_detail/$returnId"
    fun feedback(role: String) = "feedback/$role"
}

/** Skaner natijasi shu kalit bilan chaqiruvchi ekranning SavedStateHandle'iga qaytariladi. */
private const val SCAN_RESULT_KEY = "scanned_barcode"

/** Sessiya holatiga qarab Login yoki asosiy NavHost'ni ko'rsatadi. */
@Composable
fun AppRoot() {
    val authViewModel: AuthViewModel = hiltViewModel()
    val session by authViewModel.session.collectAsStateWithLifecycle()

    when (val state = session) {
        is SessionState.Checking -> LoadingScreen()
        is SessionState.LoggedOut -> LoginScreen(viewModel = authViewModel)
        is SessionState.LoggedIn -> MainNavHost(user = state.user, authViewModel = authViewModel)
    }
}

@Composable
private fun MainNavHost(user: MeResponse, authViewModel: AuthViewModel) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                user = user,
                viewModel = authViewModel,
                onOpenPickTasks = { navController.navigate(Routes.PICK_TASKS) },
                onOpenInventory = { navController.navigate(Routes.INVENTORY) },
                onOpenReceiving = { navController.navigate(Routes.RECEIVING) },
                onOpenCustomerReturns = { navController.navigate(Routes.CUSTOMER_RETURNS) },
                onOpenAccount = { navController.navigate(Routes.ACCOUNT) },
                onOpenFeedback = { navController.navigate(Routes.feedback(user.role)) },
                onOpenMovement = { navController.navigate(Routes.MOVEMENT) },
            )
        }
        composable(Routes.PICK_TASKS) {
            PickTaskListScreen(
                onOpenDocument = { documentId -> navController.navigate(Routes.pickTaskDetail(documentId)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(
            route = Routes.PICK_TASK_DETAIL,
            arguments = listOf(navArgument("documentId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val scannedBarcode by backStackEntry.savedStateHandle
                .getStateFlow<String?>(SCAN_RESULT_KEY, null)
                .collectAsStateWithLifecycle()
            PickTaskDetailScreen(
                onBack = { navController.popBackStack() },
                onScan = { navController.navigate(Routes.SCANNER) },
                scannedBarcode = scannedBarcode,
                onScannedBarcodeConsumed = { backStackEntry.savedStateHandle[SCAN_RESULT_KEY] = null },
            )
        }
        composable(Routes.INVENTORY) { backStackEntry ->
            val scannedBarcode by backStackEntry.savedStateHandle
                .getStateFlow<String?>(SCAN_RESULT_KEY, null)
                .collectAsStateWithLifecycle()
            InventorySearchScreen(
                onBack = { navController.popBackStack() },
                onScan = { navController.navigate(Routes.SCANNER) },
                scannedBarcode = scannedBarcode,
                onScannedBarcodeConsumed = { backStackEntry.savedStateHandle[SCAN_RESULT_KEY] = null },
            )
        }
        composable(Routes.RECEIVING) { backStackEntry ->
            val scannedBarcode by backStackEntry.savedStateHandle
                .getStateFlow<String?>(SCAN_RESULT_KEY, null)
                .collectAsStateWithLifecycle()
            NewReceiptScreen(
                onBack = { navController.popBackStack() },
                onScan = { navController.navigate(Routes.SCANNER) },
                scannedBarcode = scannedBarcode,
                onScannedBarcodeConsumed = { backStackEntry.savedStateHandle[SCAN_RESULT_KEY] = null },
            )
        }
        composable(Routes.CUSTOMER_RETURNS) {
            CustomerReturnQueueScreen(
                onOpenReturn = { returnId -> navController.navigate(Routes.customerReturnDetail(returnId)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(
            route = Routes.CUSTOMER_RETURN_DETAIL,
            arguments = listOf(navArgument("returnId") { type = NavType.StringType }),
        ) {
            CustomerReturnDetailScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.ACCOUNT) {
            ChangePasswordScreen(onBack = { navController.popBackStack() })
        }
        composable(
            route = Routes.FEEDBACK,
            arguments = listOf(navArgument("role") { type = NavType.StringType }),
        ) {
            FeedbackScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.SCANNER) {
            ScannerScreen(
                onResult = { barcode ->
                    navController.previousBackStackEntry?.savedStateHandle?.set(SCAN_RESULT_KEY, barcode)
                    navController.popBackStack()
                },
                onCancel = { navController.popBackStack() },
            )
        }
        composable(Routes.MOVEMENT) {
            MovementScreen(onBack = { navController.popBackStack() })
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
