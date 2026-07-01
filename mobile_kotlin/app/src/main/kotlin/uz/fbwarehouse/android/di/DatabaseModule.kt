package uz.fbwarehouse.android.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import uz.fbwarehouse.android.core.db.AppDatabase
import uz.fbwarehouse.android.core.db.PendingPickDao
import uz.fbwarehouse.android.core.db.PendingReceiptDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "wms_offline.db")
            // Kesh faqat vaqtinchalik navbat (yuborilmagan pick'lar) saqlaydi — sxema o'zgarganda
            // eski qatorlarni yo'qotish xavfsiz, migratsiya yozish shart emas.
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun providePendingPickDao(database: AppDatabase): PendingPickDao = database.pendingPickDao()

    @Provides
    fun providePendingReceiptDao(database: AppDatabase): PendingReceiptDao = database.pendingReceiptDao()
}
