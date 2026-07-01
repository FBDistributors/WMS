package uz.fbwarehouse.android.receiving.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import uz.fbwarehouse.android.R
import uz.fbwarehouse.android.ui.components.toDisplayMessageRes
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewReceiptScreen(
    onBack: () -> Unit,
    onScan: () -> Unit,
    scannedBarcode: String?,
    onScannedBarcodeConsumed: () -> Unit,
    viewModel: NewReceiptViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(scannedBarcode) {
        if (!scannedBarcode.isNullOrBlank()) {
            viewModel.onBarcodeScanned(scannedBarcode)
            onScannedBarcodeConsumed()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.receiving_title)) },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = uiState.barcodeQuery,
                    onValueChange = viewModel::onBarcodeChange,
                    label = { Text(stringResource(R.string.receiving_barcode_hint)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { viewModel.searchProduct() }),
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onScan) {
                    Icon(imageVector = Icons.Filled.QrCodeScanner, contentDescription = null)
                }
                Button(
                    onClick = viewModel::searchProduct,
                    enabled = !uiState.isSearching && uiState.barcodeQuery.isNotBlank(),
                    modifier = Modifier.padding(start = 8.dp),
                ) {
                    if (uiState.isSearching) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                    } else {
                        Text(stringResource(R.string.receiving_search_button))
                    }
                }
            }

            uiState.searchError?.let { error ->
                Text(
                    text = stringResource(error.toDisplayMessageRes()),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            uiState.foundProduct?.let { product ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(text = product.name, style = MaterialTheme.typography.titleMedium)
                        product.barcode?.let {
                            Text(text = it, style = MaterialTheme.typography.bodyMedium)
                        }
                        if (uiState.isBoxScan) {
                            Text(
                                text = stringResource(R.string.receiving_box_scan_label),
                                color = MaterialTheme.colorScheme.primary,
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                    }
                }

                var expanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                ) {
                    OutlinedTextField(
                        value = uiState.selectedLocation?.let { "${it.code} — ${it.name}" } ?: "",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text(stringResource(R.string.receiving_location_label)) },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                        modifier = Modifier
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable, true)
                            .fillMaxWidth(),
                    )
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        uiState.locations.forEach { location ->
                            DropdownMenuItem(
                                text = { Text("${location.code} — ${location.name}") },
                                onClick = {
                                    viewModel.onLocationSelected(location.id)
                                    expanded = false
                                },
                            )
                        }
                    }
                }

                if (uiState.isBoxScan) {
                    OutlinedTextField(
                        value = uiState.boxCountText,
                        onValueChange = viewModel::onBoxCountChange,
                        label = { Text(stringResource(R.string.receiving_box_count_hint)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 16.dp),
                    )
                    uiState.computedBoxQty?.let { computedQty ->
                        Text(
                            text = stringResource(
                                R.string.receiving_box_computed_qty,
                                computedQty,
                                uiState.foundProduct?.unitsPerBox ?: 0,
                            ),
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                } else {
                    OutlinedTextField(
                        value = uiState.qtyText,
                        onValueChange = viewModel::onQtyChange,
                        label = { Text(stringResource(R.string.receiving_qty_hint)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 16.dp),
                    )
                }

                OutlinedTextField(
                    value = uiState.batchText,
                    onValueChange = viewModel::onBatchChange,
                    label = { Text(stringResource(R.string.receiving_batch_hint)) },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                )

                var showDatePicker by remember { mutableStateOf(false) }
                OutlinedTextField(
                    value = uiState.expiryDate ?: "",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text(stringResource(R.string.receiving_expiry_hint)) },
                    trailingIcon = {
                        if (uiState.expiryDate != null) {
                            IconButton(onClick = { viewModel.onExpiryDateChange(null) }) {
                                Icon(
                                    imageVector = Icons.Filled.Close,
                                    contentDescription = stringResource(R.string.receiving_expiry_clear),
                                )
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp)
                        .clickable { showDatePicker = true },
                )

                if (showDatePicker) {
                    val datePickerState = rememberDatePickerState()
                    DatePickerDialog(
                        onDismissRequest = { showDatePicker = false },
                        confirmButton = {
                            TextButton(onClick = {
                                val millis = datePickerState.selectedDateMillis
                                if (millis != null) {
                                    val isoDate = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()
                                    viewModel.onExpiryDateChange(isoDate)
                                }
                                showDatePicker = false
                            }) {
                                Text(stringResource(R.string.common_select))
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = { showDatePicker = false }) {
                                Text(stringResource(R.string.common_back))
                            }
                        },
                    ) {
                        DatePicker(state = datePickerState)
                    }
                }

                Button(
                    onClick = viewModel::addLine,
                    enabled = uiState.canAddLine,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                ) {
                    Text(stringResource(R.string.receiving_add_line_button))
                }
            }

            if (uiState.pendingLines.isNotEmpty()) {
                Text(
                    text = stringResource(R.string.receiving_pending_lines_title, uiState.pendingLines.size),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 24.dp),
                )
                uiState.pendingLines.forEachIndexed { index, line ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(text = line.productName, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    text = stringResource(
                                        R.string.receiving_line_qty_location,
                                        line.qty,
                                        line.locationLabel,
                                    ),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                                if (line.batch != null || line.expiryDate != null) {
                                    Text(
                                        text = stringResource(
                                            R.string.receiving_line_batch_expiry,
                                            line.batch ?: "—",
                                            line.expiryDate ?: "—",
                                        ),
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                }
                            }
                            IconButton(onClick = { viewModel.removeLine(index) }) {
                                Icon(imageVector = Icons.Filled.Close, contentDescription = stringResource(R.string.common_back))
                            }
                        }
                    }
                }
            }

            uiState.submitError?.let { error ->
                Text(
                    text = stringResource(error.toDisplayMessageRes()),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            if (uiState.pendingLines.isNotEmpty()) {
                OutlinedButton(
                    onClick = viewModel::submit,
                    enabled = uiState.canSubmit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                ) {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = MaterialTheme.colorScheme.primary,
                        )
                    } else {
                        Text(stringResource(R.string.receiving_submit_button))
                    }
                }
            }

            uiState.lastReceiptDocNo?.let { docNo ->
                Text(
                    text = stringResource(R.string.receiving_success, docNo),
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }

            if (uiState.lastReceiptQueued) {
                Text(
                    text = stringResource(R.string.receiving_queued_offline),
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }
    }
}
