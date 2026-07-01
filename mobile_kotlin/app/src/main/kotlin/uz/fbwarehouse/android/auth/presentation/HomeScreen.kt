package uz.fbwarehouse.android.auth.presentation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import uz.fbwarehouse.android.R
import uz.fbwarehouse.android.core.network.MeResponse

@Composable
fun HomeScreen(
    user: MeResponse,
    viewModel: AuthViewModel,
    onOpenPickTasks: () -> Unit,
    onOpenInventory: () -> Unit,
    onOpenReceiving: () -> Unit,
    onOpenCustomerReturns: () -> Unit,
    onOpenAccount: () -> Unit,
    onOpenFeedback: () -> Unit,
    onOpenMovement: () -> Unit,
) {
    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(R.string.home_greeting, user.fullName ?: user.username),
                style = MaterialTheme.typography.headlineSmall,
            )
            Text(
                text = stringResource(R.string.home_role_label, user.role),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 8.dp),
            )
            Button(
                onClick = onOpenPickTasks,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 24.dp),
            ) {
                Text(stringResource(R.string.home_open_pick_tasks))
            }
            OutlinedButton(
                onClick = onOpenInventory,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                Text(stringResource(R.string.home_open_inventory))
            }
            OutlinedButton(
                onClick = onOpenReceiving,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                Text(stringResource(R.string.home_open_receiving))
            }
            OutlinedButton(
                onClick = onOpenCustomerReturns,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                Text(stringResource(R.string.home_open_customer_returns))
            }
            OutlinedButton(
                onClick = onOpenMovement,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                Text(stringResource(R.string.home_open_movement))
            }
            OutlinedButton(
                onClick = onOpenAccount,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                Text(stringResource(R.string.home_open_account))
            }
            OutlinedButton(
                onClick = onOpenFeedback,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                Text(stringResource(R.string.home_open_feedback))
            }
            OutlinedButton(
                onClick = viewModel::logout,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                Text(stringResource(R.string.home_logout))
            }
        }
    }
}
