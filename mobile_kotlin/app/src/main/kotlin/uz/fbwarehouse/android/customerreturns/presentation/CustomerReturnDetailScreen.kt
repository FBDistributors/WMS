package uz.fbwarehouse.android.customerreturns.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import uz.fbwarehouse.android.R
import uz.fbwarehouse.android.core.network.CustomerReturnLineOutDto
import uz.fbwarehouse.android.core.network.LocationDto
import uz.fbwarehouse.android.core.network.PickerUserDto
import uz.fbwarehouse.android.ui.components.ErrorRetry
import uz.fbwarehouse.android.ui.components.LoadingBox
import uz.fbwarehouse.android.ui.components.toDisplayMessageRes
import uz.fbwarehouse.android.ui.format.formatQty

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerReturnDetailScreen(
    onBack: () -> Unit,
    viewModel: CustomerReturnDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val customerReturn = uiState.customerReturn

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(R.string.customer_return_detail_title, customerReturn?.docNo ?: ""))
                },
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
            uiState.isLoading && customerReturn == null -> LoadingBox(modifier = Modifier.padding(padding))
            uiState.error != null && customerReturn == null -> ErrorRetry(
                error = uiState.error!!,
                onRetry = viewModel::load,
                modifier = Modifier.padding(padding),
            )
            customerReturn != null -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(customerReturn.lines, key = { it.id }) { line ->
                        CustomerReturnLineCard(line = line)
                    }
                }

                uiState.error?.let { error ->
                    Text(
                        text = stringResource(error.toDisplayMessageRes()),
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }

                Column(modifier = Modifier.padding(16.dp)) {
                    when (customerReturn.status) {
                        CUSTOMER_RETURN_STATUS_PENDING -> ApproveAction(
                            isApproving = uiState.isApproving,
                            onApprove = viewModel::approve,
                        )
                        CUSTOMER_RETURN_STATUS_APPROVED -> AssignPickerAction(
                            pickers = uiState.pickers,
                            selectedPickerId = uiState.selectedPickerId,
                            isAssigning = uiState.isAssigning,
                            onPickerSelected = viewModel::onPickerSelected,
                            onAssign = viewModel::assignPicker,
                        )
                        CUSTOMER_RETURN_STATUS_ASSIGNED -> CompleteAction(
                            locations = uiState.locations,
                            selectedLocationId = uiState.selectedLocationId,
                            isCompleting = uiState.isCompleting,
                            onLocationSelected = viewModel::onLocationSelected,
                            onComplete = viewModel::complete,
                        )
                        CUSTOMER_RETURN_STATUS_COMPLETED -> Text(
                            text = stringResource(R.string.customer_return_completed_label),
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ApproveAction(isApproving: Boolean, onApprove: () -> Unit) {
    Button(onClick = onApprove, enabled = !isApproving, modifier = Modifier.fillMaxWidth()) {
        if (isApproving) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary)
        } else {
            Text(stringResource(R.string.customer_return_approve_button))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AssignPickerAction(
    pickers: List<PickerUserDto>,
    selectedPickerId: String?,
    isAssigning: Boolean,
    onPickerSelected: (String) -> Unit,
    onAssign: () -> Unit,
) {
    val selected = pickers.firstOrNull { it.id == selectedPickerId }
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = Modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = selected?.fullName ?: selected?.username ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.customer_return_assign_picker_label)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryNotEditable, true)
                .fillMaxWidth(),
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            pickers.forEach { picker ->
                DropdownMenuItem(
                    text = { Text(picker.fullName ?: picker.username) },
                    onClick = {
                        onPickerSelected(picker.id)
                        expanded = false
                    },
                )
            }
        }
    }

    Button(
        onClick = onAssign,
        enabled = !isAssigning && selectedPickerId != null,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp),
    ) {
        if (isAssigning) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary)
        } else {
            Text(stringResource(R.string.customer_return_assign_button))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CompleteAction(
    locations: List<LocationDto>,
    selectedLocationId: String?,
    isCompleting: Boolean,
    onLocationSelected: (String) -> Unit,
    onComplete: () -> Unit,
) {
    val selected = locations.firstOrNull { it.id == selectedLocationId }
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = Modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = selected?.let { "${it.code} — ${it.name}" } ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.customer_return_location_label)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryNotEditable, true)
                .fillMaxWidth(),
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            locations.forEach { location ->
                DropdownMenuItem(
                    text = { Text("${location.code} — ${location.name}") },
                    onClick = {
                        onLocationSelected(location.id)
                        expanded = false
                    },
                )
            }
        }
    }

    Button(
        onClick = onComplete,
        enabled = !isCompleting && selectedLocationId != null,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp),
    ) {
        if (isCompleting) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary)
        } else {
            Text(stringResource(R.string.customer_return_complete_button))
        }
    }
}

@Composable
private fun CustomerReturnLineCard(line: CustomerReturnLineOutDto) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = line.productName, style = MaterialTheme.typography.titleMedium)
            Text(
                text = stringResource(
                    R.string.customer_return_qty_location,
                    formatQty(line.qty),
                    line.locationCode,
                ),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
