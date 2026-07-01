package uz.fbwarehouse.android.customerreturns.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import uz.fbwarehouse.android.R
import uz.fbwarehouse.android.core.network.CustomerReturnOutDto
import uz.fbwarehouse.android.ui.components.ErrorRetry
import uz.fbwarehouse.android.ui.components.LoadingBox

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerReturnQueueScreen(
    onOpenReturn: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: CustomerReturnQueueViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.customer_returns_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        when {
            uiState.isLoading -> LoadingBox(modifier = Modifier.padding(padding))
            uiState.error != null -> ErrorRetry(
                error = uiState.error!!,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            uiState.items.isEmpty() -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.customer_returns_empty))
            }
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(uiState.items, key = { it.id }) { item ->
                    CustomerReturnCard(item = item, onClick = { onOpenReturn(item.id) })
                }
            }
        }
    }
}

@Composable
private fun CustomerReturnCard(item: CustomerReturnOutDto, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = item.docNo, style = MaterialTheme.typography.titleMedium)
            item.customerName?.let {
                Text(text = it, style = MaterialTheme.typography.bodyMedium)
            }
            Text(
                text = stringResource(statusLabelRes(item.status)),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

private fun statusLabelRes(status: String): Int = when (status) {
    CUSTOMER_RETURN_STATUS_PENDING -> R.string.customer_return_status_pending_controller
    CUSTOMER_RETURN_STATUS_APPROVED -> R.string.customer_return_status_approved
    CUSTOMER_RETURN_STATUS_ASSIGNED -> R.string.customer_return_status_assigned_to_picker
    CUSTOMER_RETURN_STATUS_COMPLETED -> R.string.customer_return_status_completed
    else -> R.string.customer_return_status_pending_controller
}
