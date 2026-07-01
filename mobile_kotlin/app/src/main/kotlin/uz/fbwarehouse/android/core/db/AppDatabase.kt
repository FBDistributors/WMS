package uz.fbwarehouse.android.core.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [PendingPickEntity::class, PendingReceiptEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingPickDao(): PendingPickDao
    abstract fun pendingReceiptDao(): PendingReceiptDao
}
